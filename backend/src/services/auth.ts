import { Client } from "pg";
import Redis from "ioredis";
import crypto from "crypto";

export type SessionInfo = {
  userId: string;
  email: string;
  loggedInAt: string;
};

export type LoginResult = { sessionId: string; userId: string };

export async function login(
  email: string,
  password: string,
  pgClient: Client,
  redis: Redis,
): Promise<LoginResult> {
  const result = await pgClient.query(
    "SELECT id, email FROM users WHERE email=$1 AND password=md5($2)",
    [email, password],
  );
  if (result.rows.length === 0) throw new Error("authentication failed");
  const { id: userId, email: userEmail } = result.rows[0];
  const sessionId = crypto.randomBytes(32).toString("hex");
  const sessionInfo: SessionInfo = {
    userId,
    email: userEmail,
    loggedInAt: new Date().toISOString(),
  };
  await redis.set(`session:${sessionId}`, JSON.stringify(sessionInfo), "EX", 3600);
  return { sessionId, userId };
}

export async function getSessionInfo(sessionId: string, redis: Redis): Promise<SessionInfo | null> {
  if (!sessionId) return null;
  const value = await redis.get(`session:${sessionId}`);
  if (!value) return null;
  try {
    return JSON.parse(value) as SessionInfo;
  } catch {
    return null;
  }
}

export async function logout(sessionId: string, redis: Redis): Promise<void> {
  if (sessionId) {
    await redis.del(`session:${sessionId}`);
  }
}
