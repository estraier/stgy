import { Config } from "../config";
import { IdIssueService } from "./idIssue";
import type {
  AnyEventPayload,
  ReplyEventPayload,
  LikeEventPayload,
  FollowEventPayload,
} from "../models/eventLog";
import { Client } from "pg";
import Redis from "ioredis";

export class EventLogService {
  private pgClient: Client;
  private idIssueService: IdIssueService;
  private redis: Redis;

  constructor(pgClient: Client, redis: Redis) {
    this.pgClient = pgClient;
    this.redis = redis;
    this.idIssueService = new IdIssueService(Config.ID_ISSUE_WORKER_ID);
  }

  partitionForId(id: string): number {
    const mod = Config.EVENT_LOG_PARTITIONS;
    if (!(mod > 0)) return 0;
    const hex = id.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length === 0) return 0;
    let acc = 0;
    for (let i = 0; i < hex.length; i++) {
      const c = hex.charCodeAt(i);
      let v: number;
      if (c >= 48 && c <= 57) v = c - 48;
      else if (c >= 65 && c <= 70) v = c - 55;
      else if (c >= 97 && c <= 102) v = c - 87;
      else continue;
      acc = (acc * 16 + v) % mod;
    }
    return acc;
  }

  async recordReply(input: {
    userId: string;
    postId: string;
    replyToPostId: string;
  }): Promise<bigint> {
    const payload: ReplyEventPayload = {
      type: "reply",
      userId: input.userId,
      postId: input.postId,
      replyToPostId: input.replyToPostId,
    };
    const partitionId = this.partitionForId(input.replyToPostId);
    return this.insert(partitionId, payload);
  }

  async recordLike(input: { userId: string; postId: string }): Promise<bigint> {
    const payload: LikeEventPayload = { type: "like", userId: input.userId, postId: input.postId };
    const partitionId = this.partitionForId(input.postId);
    return this.insert(partitionId, payload);
  }

  async recordFollow(input: { followerId: string; followeeId: string }): Promise<bigint> {
    const payload: FollowEventPayload = {
      type: "follow",
      followerId: input.followerId,
      followeeId: input.followeeId,
    };
    const partitionId = this.partitionForId(input.followeeId);
    return this.insert(partitionId, payload);
  }

  async purgeOldRecords(partitionId: number): Promise<number> {
    if (
      !Number.isInteger(partitionId) ||
      partitionId < 0 ||
      partitionId >= Config.EVENT_LOG_PARTITIONS
    ) {
      throw new Error("invalid partitionId");
    }
    const days = Config.EVENT_LOG_RETENTION_DAYS;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoffId = IdIssueService.lowerBoundIdForDate(cutoffDate).toString();
    await this.pgClient.query("BEGIN");
    try {
      await this.pgClient.query("SET LOCAL statement_timeout = 10000");
      const res = await this.pgClient.query(
        "DELETE FROM event_logs WHERE partition_id = $1 AND event_id < $2",
        [partitionId, cutoffId],
      );
      await this.pgClient.query("COMMIT");
      return res.rowCount ?? 0;
    } catch (e) {
      await this.pgClient.query("ROLLBACK");
      throw e;
    }
  }

  private wakeChannel(workerIndex: number): string {
    return `notifications:wake:${workerIndex}`;
  }

  private workerIndexOfPartition(partitionId: number): number {
    const n = Math.max(1, (Config.NOTIFICATION_WORKERS as number) | 0);
    return ((partitionId % n) + n) % n;
  }

  private async notifyPartition(partitionId: number): Promise<void> {
    const idx = this.workerIndexOfPartition(partitionId);
    await this.redis.publish(this.wakeChannel(idx), String(partitionId));
  }

  private async insert(partitionId: number, payload: AnyEventPayload): Promise<bigint> {
    const idBig = await this.idIssueService.issueBigint();
    const eventId = idBig.toString();
    await this.pgClient.query(
      "INSERT INTO event_logs (partition_id, event_id, payload) VALUES ($1, $2, $3::jsonb)",
      [partitionId, eventId, JSON.stringify(payload)],
    );
    await this.notifyPartition(partitionId);
    return idBig;
  }

  async loadCursor(consumer: string, partitionId: number): Promise<bigint> {
    const res = await this.pgClient.query<{ last_event_id: string }>(
      `SELECT last_event_id
         FROM event_log_cursors
        WHERE consumer = $1 AND partition_id = $2`,
      [consumer, partitionId],
    );
    if (res.rows.length === 0) {
      await this.pgClient.query(
        `INSERT INTO event_log_cursors (consumer, partition_id, last_event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (consumer, partition_id) DO NOTHING`,
        [consumer, partitionId, "0"],
      );
      return BigInt(0);
    }
    return BigInt(res.rows[0].last_event_id);
  }

  async saveCursor(
    tx: Client,
    consumer: string,
    partitionId: number,
    lastEventId: bigint,
  ): Promise<void> {
    await tx.query(
      `UPDATE event_log_cursors
          SET last_event_id = $3, updated_at = now()
        WHERE consumer = $1 AND partition_id = $2`,
      [consumer, partitionId, lastEventId.toString()],
    );
  }

  async fetchBatch(
    partitionId: number,
    afterId: bigint,
    limit: number = Config.NOTIFICATION_BATCH_SIZE,
  ): Promise<Array<{ event_id: string; payload: AnyEventPayload }>> {
    const res = await this.pgClient.query<{ event_id: string; payload: AnyEventPayload }>(
      `SELECT event_id, payload
         FROM event_logs
        WHERE partition_id = $1
          AND event_id > $2::bigint
        ORDER BY event_id ASC
        LIMIT $3`,
      [partitionId, afterId.toString(), limit],
    );
    return res.rows;
  }
}
