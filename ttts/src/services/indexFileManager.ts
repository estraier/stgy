import fs from "fs/promises";
import path from "path";
import { Database } from "../utils/database";
import { SearchConfig, IndexFileInfo } from "./search";

export class IndexFileManager {
  constructor(private config: SearchConfig) {}

  /**
   * タイムスタンプをバケット（シャード）の開始時刻に丸める。
   * 例: duration=100, ts=150 -> 100
   */
  getBucketTimestamp(timestamp: number): number {
    return (
      Math.floor(timestamp / this.config.bucketDurationSeconds) * this.config.bucketDurationSeconds
    );
  }

  /**
   * バケットのタイムスタンプからファイルパスを生成する。
   */
  getFilePath(bucketTimestamp: number): string {
    return path.join(this.config.baseDir, `${this.config.namePrefix}-${bucketTimestamp}.db`);
  }

  /**
   * ディレクトリ内のインデックスファイルを列挙し、新しい順にソートして返す。
   */
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
        totalDatabaseSize: stats.size,
        indexSize: 0,
        contentSize: 0,
        countDocuments: 0,
        startTimestamp,
        endTimestamp,
        isHealthy: true,
      };

      // WALファイルのサイズ確認
      try {
        const walStats = await fs.stat(`${filePath}-wal`);
        info.walSize = walStats.size;
        info.totalDatabaseSize += walStats.size;
      } catch {
        // WALがない場合は0のまま
      }

      if (detailed) {
        await this.fillDetailedInfo(filePath, info);
      }

      indexFiles.push(info);
    }

    // 新しい順（降順）にソート
    return indexFiles.sort((a, b) => b.startTimestamp - a.startTimestamp);
  }

  /**
   * 特定のシャード（ファイルセット）を物理削除する。
   */
  async removeIndexFile(bucketTimestamp: number): Promise<void> {
    const filePath = this.getFilePath(bucketTimestamp);
    await this.deleteFileSet(filePath);
  }

  /**
   * 全てのインデックスファイルを削除する。
   */
  async removeAllIndexFiles(): Promise<void> {
    const files = await this.listIndexFiles(false);
    for (const file of files) {
      await this.removeIndexFile(file.startTimestamp);
    }
  }

  /**
   * 詳細情報をDBを開いて取得する
   */
  private async fillDetailedInfo(filePath: string, info: IndexFileInfo): Promise<void> {
    let db: Database | null = null;
    try {
      // 読み取り専用で開く
      db = await Database.open(filePath);

      // 1. ドキュメント数
      const countRow = await db.get<{ c: number }>("SELECT count(*) as c FROM id_tuples");
      info.countDocuments = countRow?.c ?? 0;

      // 2. インデックスサイズ (FTS5 shadow tables)
      // docs_data: 転置インデックス本体 (BLOB) - 必須
      // docs_docsize: 文書サイズ情報 (Varint) - detail!=noneなら存在
      // docs_idx: セグメント情報 - サイズ計算が複雑なため今回は除外 (データ量は微々たるもの)
      try {
        const indexSizeRow = await db.get<{ size: number }>(`
          SELECT
            (SELECT COALESCE(SUM(length(block)), 0) FROM docs_data) +
            (SELECT COALESCE(SUM(length(sz)), 0) FROM docs_docsize) as size
        `);
        info.indexSize = indexSizeRow?.size ?? 0;
      } catch (e) {
        // detail=noneの場合 docs_docsize がない等の理由で失敗する可能性があるため
        // その場合は docs_data だけでも試みる
        try {
          const minimalSize = await db.get<{ size: number }>(`
            SELECT (SELECT COALESCE(SUM(length(block)), 0) FROM docs_data) as size
          `);
          info.indexSize = minimalSize?.size ?? 0;
        } catch {
          info.indexSize = 0;
        }
      }

      // 3. コンテンツサイズ (FTS5 shadow table: docs_content)
      try {
        const contentSizeRow = await db.get<{ size: number }>(`
          SELECT COALESCE(SUM(length(c0)), 0) as size FROM docs_content
        `);
        info.contentSize = contentSizeRow?.size ?? 0;
      } catch (e) {
        info.contentSize = 0;
      }
    } catch (e) {
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
