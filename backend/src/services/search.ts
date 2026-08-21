import { Pool, type PoolClient } from "pg";
import { Config } from "../config";
import { Document, SearchInput, SearchResult } from "../models/search";
import { IdIssueService } from "./idIssue";
import { pgQuery } from "../utils/servers";
import { decToHex, hexToDec } from "../utils/format";

export type SearchIndexTask = {
  id: string;
  resourceType: string;
  resourceId: string;
  bodyText: string | null;
  locale: string | null;
  timestamp: string;
};

export class SearchService {
  private readonly pgPool: Pool;
  private readonly idIssueService: IdIssueService;
  private readonly resourceName: string;
  private readonly searchBaseUrl: string;

  constructor(pgPool: Pool, resourceName: string) {
    this.pgPool = pgPool;
    this.idIssueService = new IdIssueService(Config.ID_ISSUE_WORKER_ID);
    this.resourceName = resourceName;
    this.searchBaseUrl = `${Config.SEARCH_API_BASE_URL}/${resourceName}`;
  }

  async addDocument(doc: Document): Promise<void> {
    const url = `${this.searchBaseUrl}/${doc.id}`;
    const body = {
      text: doc.bodyText,
      timestamp: doc.timestamp,
      locale: doc.locale,
      attrs: null,
      labels: doc.labels,
      numericValue: doc.numericValue,
    };
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Failed to add document to search index [${res.status}]: ${errorText}`);
    }
  }

  async removeDocument(id: string, timestamp: number): Promise<void> {
    const url = `${this.searchBaseUrl}/${id}`;
    const body = { timestamp };

    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Failed to remove document from search index [${res.status}]: ${errorText}`);
    }
  }

  async search(input: SearchInput): Promise<SearchResult<string>> {
    const params = new URLSearchParams();
    params.append("query", input.query);
    params.append("locale", input.locale);

    if (input.limit !== undefined) params.append("limit", input.limit.toString());
    if (input.offset !== undefined) params.append("offset", input.offset.toString());
    if (input.timeout !== undefined) params.append("timeout", input.timeout.toString());
    for (const label of input.labels ?? []) params.append("label", label);
    if (input.numericOp !== undefined) params.append("numericOp", input.numericOp);
    if (input.numericValue !== undefined)
      params.append("numericValue", input.numericValue.toString());

    const url = `${this.searchBaseUrl}/search?${params.toString()}`;

    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Search request failed [${res.status}]: ${errorText}`);
    }

    const result: SearchResult<string> = await res.json();
    return result;
  }

  async getIndexMetadata(
    id: string,
  ): Promise<{ labels: string[]; numericValue: number | null } | null> {
    if (this.resourceName !== "posts") return { labels: [], numericValue: null };
    const res = await pgQuery<{ owned_by: string; published_at: string | Date | null }>(
      this.pgPool,
      `SELECT owned_by, published_at FROM posts WHERE id = $1`,
      [hexToDec(id)],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const publishedAtMs = row.published_at === null ? null : new Date(row.published_at).getTime();
    return {
      labels: [`owner:${decToHex(row.owned_by)}`],
      numericValue:
        publishedAtMs !== null && Number.isFinite(publishedAtMs) ? publishedAtMs : null,
    };
  }

  async enqueueAddDocument(
    doc: Pick<Document, "id" | "timestamp" | "bodyText" | "locale">,
    client?: PoolClient,
  ): Promise<void> {
    const taskId = await this.idIssueService.issueBigint();
    const sql = `
      INSERT INTO search_indexing_tasks
      (id, name_prefix, doc_id, body_text, locale, doc_timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const params = [taskId, this.resourceName, doc.id, doc.bodyText, doc.locale, doc.timestamp];
    await pgQuery(client ?? this.pgPool, sql, params);
  }

  async enqueueRemoveDocument(
    id: string,
    timestamp: number,
    client?: PoolClient,
  ): Promise<void> {
    const taskId = await this.idIssueService.issueBigint();
    const sql = `
      INSERT INTO search_indexing_tasks
      (id, name_prefix, doc_id, body_text, locale, doc_timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const params = [taskId, this.resourceName, id, null, null, timestamp];
    await pgQuery(client ?? this.pgPool, sql, params);
  }

  async fetchTasks(limit: number): Promise<SearchIndexTask[]> {
    const sql = `
      SELECT id, name_prefix, doc_id, body_text, locale, doc_timestamp
      FROM search_indexing_tasks
      WHERE name_prefix = $1
      ORDER BY id ASC
      LIMIT $2
    `;
    const res = await pgQuery<{
      id: string;
      name_prefix: string;
      doc_id: string;
      body_text: string | null;
      locale: string | null;
      doc_timestamp: string;
    }>(this.pgPool, sql, [this.resourceName, limit]);

    return res.rows.map((row) => ({
      id: row.id,
      resourceType: row.name_prefix,
      resourceId: row.doc_id,
      bodyText: row.body_text,
      locale: row.locale,
      timestamp: row.doc_timestamp,
    }));
  }

  async deleteTasks(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(",");
    const sql = `DELETE FROM search_indexing_tasks WHERE id IN (${placeholders})`;
    await pgQuery(this.pgPool, sql, taskIds);
  }
}
