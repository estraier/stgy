import { Request } from "express";
import Redis from "ioredis";
import { Client } from "pg";
import * as authService from "../services/auth";
import * as usersService from "../services/users";

export async function getSessionInfo(req: Request, redis: Redis) {
  const sessionId = req.cookies?.session_id;
  if (!sessionId) return null;
  return await authService.getSessionInfo(sessionId, redis);
}

export async function getCurrentUser(req: Request, redis: Redis, pgClient: Client) {
  const sessionInfo = await getSessionInfo(req, redis);
  if (!sessionInfo || !sessionInfo.userId) return null;
  return await usersService.getUser(sessionInfo.userId, pgClient);
}
