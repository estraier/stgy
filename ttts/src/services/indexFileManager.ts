import fs from "fs/promises";
import path from "path";
import { Database } from "../utils/database";
import { SearchConfig, IndexFileInfo } from "./search";

const CONFIG_DB_PAGE_SIZE_BYTES = 8192;

export class IndexFileManager {
  private config: SearchConfig;

  constructor(config: SearchConfig) {
    this.config = config;
  }

  public getBucketTimestamp(timestamp: number): number {
    return (
      Math.floor(timestamp / this.config.bucketDurationSeconds) * this.config.bucketDurationSeconds
    );
  }

  public getFilePath(timestamp: number): string {
    const bucketTs = this.getBucketTimestamp(timestamp);
    const filename = `${this.config.namePrefix}-${bucketTs}.db`;
    return path.join(this.config.baseDir, filename);
  }

  public async listIndexFiles(detailed: boolean = false): Promise<IndexFileInfo[]> {
    const infos: IndexFileInfo[] = [];
    try {
      const files = await fs.readdir(this.config.baseDir);
      for (const file of files) {
        if (file.startsWith(this.config.namePrefix) && file.endsWith(".db")) {
          const prefixLength = this.config.namePrefix.length + 1;
          const tsStr = file.substring(prefixLength, file.length - 3);
          const ts = parseInt(tsStr, 10);
          if (!isNaN(ts)) {
            const filepath = path.join(this.config.baseDir, file);
            const info = await this.getFileInfo(filepath, ts, detailed);
            infos.push(info);
          }
        }
      }
    } catch {
      // ignore
    }
    return infos.sort((a, b) => b.startTimestamp - a.startTimestamp);
  }

  public async removeIndexFile(timestamp: number): Promise<void> {
    const filepath = this.getFilePath(timestamp);
    await this.deleteFileSet(filepath);
  }

  public async removeAllIndexFiles(): Promise<void> {
    const infos = await this.listIndexFiles(false);
    for (const info of infos) {
      await this.removeIndexFile(info.startTimestamp);
    }
  }

  private async deleteFileSet(filepath: string): Promise<void> {
    await fs.unlink(filepath).catch(() => {});
    await fs.unlink(`${filepath}-wal`).catch(() => {});
    await fs.unlink(`${filepath}-shm`).catch(() => {});
  }

  private async getFileInfo(
    filepath: string,
    startTimestamp: number,
    detailed: boolean,
  ): Promise<IndexFileInfo> {
    let fileSize = 0;
    let walSize = 0;
    let totalDatabaseSize = 0;
    let indexSize = 0;
    let contentSize = 0;
    let countDocuments = 0;
    let isHealthy = false;

    try {
      const stats = await fs.stat(filepath);
      fileSize = stats.size;
      const walStats = await fs.stat(`${filepath}-wal`).catch(() => ({ size: 0 }));
      walSize = walStats.size;

      const db = await Database.open(filepath);
      try {
        const row = await db.get<{ c: number }>("SELECT count(*) as c FROM id_tuples");
        countDocuments = row?.c || 0;
        isHealthy = true;

        if (detailed) {
          const psRow = await db.get<{ page_size: number }>("PRAGMA page_size");
          const pcRow = await db.get<{ page_count: number }>("PRAGMA page_count");
          totalDatabaseSize = (psRow?.page_size || 0) * (pcRow?.page_count || 0);

          const idxRow = await db.get<{ c: number }>("SELECT count(*) as c FROM docs_data");
          indexSize = (idxRow?.c || 0) * CONFIG_DB_PAGE_SIZE_BYTES;

          if (this.config.recordContents) {
            try {
              const cntRow = await db.get<{ s: number }>(
                "SELECT SUM(LENGTH(c0)) as s FROM docs_content",
              );
              contentSize = cntRow?.s || 0;
            } catch {
              contentSize = 0;
            }
          }
        }
      } finally {
        await db.close();
      }
    } catch {
      isHealthy = false;
    }

    return {
      filename: path.basename(filepath),
      fileSize,
      walSize,
      totalDatabaseSize,
      indexSize,
      contentSize,
      countDocuments,
      startTimestamp,
      endTimestamp: startTimestamp + this.config.bucketDurationSeconds,
      isHealthy,
    };
  }
}
