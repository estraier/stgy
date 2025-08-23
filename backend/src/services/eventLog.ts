import { Config } from "../config";
import { IdIssueService } from "./idIssue";
import { Client } from "pg";

export type ReplyEventPayload = {
  type: "reply";
  userId: string;
  postId: string;
  replyToPostId: string;
};

export type LikeEventPayload = {
  type: "like";
  userId: string;
  postId: string;
};

export type FollowEventPayload = {
  type: "follow";
  followerId: string;
  followeeId: string;
};

export type AnyEventPayload = ReplyEventPayload | LikeEventPayload | FollowEventPayload;

export class EventLogService {
  private pgClient: Client;
  private idIssueService: IdIssueService;

  constructor(pgClient: Client) {
    this.pgClient = pgClient;
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
      if (c >= 48 && c <= 57) {
        v = c - 48;
      } else if (c >= 65 && c <= 70) {
        v = c - 55;
      } else if (c >= 97 && c <= 102) {
        v = c - 87;
      } else {
        continue;
      }
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
    const payload: LikeEventPayload = {
      type: "like",
      userId: input.userId,
      postId: input.postId,
    };
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

  async purgeOldRecords(partitionId: number, statementTimeoutMs = 10_000): Promise<number> {
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
      await this.pgClient.query("SET LOCAL statement_timeout = $1", [statementTimeoutMs]);
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

  private async insert(partitionId: number, payload: AnyEventPayload): Promise<bigint> {
    const idBig = await this.idIssueService.issueBigint();
    const eventId = idBig.toString();
    await this.pgClient.query(
      "INSERT INTO event_logs (partition_id, event_id, payload) VALUES ($1, $2, $3::jsonb)",
      [partitionId, eventId, JSON.stringify(payload)],
    );
    return idBig;
  }
}
