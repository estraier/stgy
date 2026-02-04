import fs from "fs/promises";
import path from "path";
import { Database } from "../utils/database";
import { SearchConfig } from "./search";

export type IndexFileInfo = {
  filename: string;
  fileSize: number;
  walSize: number;

  pageSize: number;
  totalPageCount: number;

  countDocuments: number;
  startTimestamp: number;
  endTimestamp: number;
  isHealthy: boolean;

  idTuplesPayloadSize: number;

  ftsIndexPayloadSize: number;
  ftsIndexBlockCount: number;

  ftsContentPayloadSize: number;
};

export class IndexFileManager {
  constructor(private config: SearchConfig) {}

  getBucketTimestamp(timestamp: number): number {
    return (
      Math.floor(timestamp / this.config.bucketDurationSeconds) * this.config.bucketDurationSeconds
    );
  }

  getFilePath(bucketTimestamp: number): string {
    return path.join(this.config.baseDir, `${this.config.namePrefix}-${bucketTimestamp}.db`);
  }

  async listIndexFiles(detailed: boolean = false): Promise<IndexFileInfo[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.config.baseDir);
    } catch {
      return [];
    }

    const indexFiles: IndexFileInfo[] = [];
    const regex = new RegExp(`^${this.config.namePrefix}-(\\d+)\\.db$`);

    for (const file of files) {
      const match = file.match(regex);
      if (!match) continue;

      const startTimestamp = parseInt(match[1], 10);
      const endTimestamp = startTimestamp + this.config.bucketDurationSeconds;
      const filePath = path.join(this.config.baseDir, file);

      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch {
        continue;
      }

      const info: IndexFileInfo = {
        filename: file,
        fileSize: stats.size,
        walSize: 0,

        pageSize: 0,
        totalPageCount: 0,

        countDocuments: 0,
        startTimestamp,
        endTimestamp,
        isHealthy: true,

        idTuplesPayloadSize: 0,
        ftsIndexPayloadSize: 0,
        ftsIndexBlockCount: 0,
        ftsContentPayloadSize: 0,
      };

      try {
        const walStats = await fs.stat(`${filePath}-wal`);
        info.walSize = walStats.size;
      } catch {}

      if (detailed) {
        await this.fillDetailedInfo(filePath, info);
      }

      indexFiles.push(info);
    }

    return indexFiles.sort((a, b) => b.startTimestamp - a.startTimestamp);
  }

  async removeIndexFile(bucketTimestamp: number): Promise<void> {
    const filePath = this.getFilePath(bucketTimestamp);
    await this.deleteFileSet(filePath);
  }

  async removeAllIndexFiles(): Promise<void> {
    const files = await this.listIndexFiles(false);
    for (const file of files) {
      await this.removeIndexFile(file.startTimestamp);
    }
  }

  private async fillDetailedInfo(filePath: string, info: IndexFileInfo): Promise<void> {
    let db: Database | null = null;
    try {
      db = await Database.open(filePath);

      const pageInfo = await db.get<{ pgsz: number; pgc: number }>(`
        SELECT
          (SELECT page_size FROM pragma_page_size) as pgsz,
          (SELECT page_count FROM pragma_page_count) as pgc
      `);
      info.pageSize = pageInfo?.pgsz ?? 4096;
      info.totalPageCount = pageInfo?.pgc ?? 0;

      const idStats = await db.get<{ c: number; s: number }>(`
        SELECT
          count(*) as c,
          COALESCE(SUM(length(external_id) + 8), 0) as s
        FROM id_tuples
      `);
      info.countDocuments = idStats?.c ?? 0;
      info.idTuplesPayloadSize = idStats?.s ?? 0;

      try {
        const dataStats = await db.get<{ size: number; blocks: number }>(`
          SELECT
            COALESCE(SUM(length(block)), 0) as size,
            count(*) as blocks
          FROM docs_data
        `);
        let totalIndexSize = dataStats?.size ?? 0;
        let totalBlocks = dataStats?.blocks ?? 0;

        try {
          const docsizeStats = await db.get<{ size: number }>(`
            SELECT COALESCE(SUM(length(sz)), 0) as size FROM docs_docsize
          `);
          totalIndexSize += docsizeStats?.size ?? 0;
        } catch {}

        info.ftsIndexPayloadSize = totalIndexSize;
        info.ftsIndexBlockCount = totalBlocks;
      } catch {
        info.ftsIndexPayloadSize = 0;
        info.ftsIndexBlockCount = 0;
      }

      try {
        const contentStats = await db.get<{ size: number }>(`
          SELECT COALESCE(SUM(length(c0)), 0) as size FROM docs_content
        `);
        info.ftsContentPayloadSize = contentStats?.size ?? 0;
      } catch {
        info.ftsContentPayloadSize = 0;
      }
    } catch {
      info.isHealthy = false;
    } finally {
      if (db) await db.close();
    }
  }

  private async deleteFileSet(basePath: string): Promise<void> {
    try {
      await fs.unlink(basePath);
    } catch {}
    try {
      await fs.unlink(`${basePath}-wal`);
    } catch {}
    try {
      await fs.unlink(`${basePath}-shm`);
    } catch {}
  }
}
