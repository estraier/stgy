import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";
import { DbStatsService } from "../services/dbStats";
import type { ListSlowQueriesInput } from "../models/dbStats";

export default function createDbStatsRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const dbStatsService = new DbStatsService(pgPool, redis);

  router.head("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).end();
    }

    const enabled = await dbStatsService.checkEnabled();
    res.setHeader("x-db-stats-enabled", enabled ? "1" : "0");
    return res.status(enabled ? 200 : 204).end();
  });

  router.post("/enable", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    try {
      await dbStatsService.enable();
      const enabled = await dbStatsService.checkEnabled();
      res.status(200).json({ result: "ok", enabled });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.post("/disable", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    try {
      await dbStatsService.disable();
      const enabled = await dbStatsService.checkEnabled();
      res.status(200).json({ result: "ok", enabled });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.post("/clear", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    try {
      await dbStatsService.clear();
      res.status(200).json({ result: "ok" });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/slow-queries", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    try {
      const input: ListSlowQueriesInput = {};
      const offset = parseIntParam(getQueryParam(req, "offset"));
      const limit = parseIntParam(getQueryParam(req, "limit"));
      const order = parseOrder(getQueryParam(req, "order"));

      if (offset !== null) input.offset = offset;
      if (limit !== null) input.limit = limit;
      if (order) input.order = order;

      const rows = await dbStatsService.listSlowQueries(input);
      res.status(200).json(rows);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}

function getQueryParam(req: Request, key: string): string | undefined {
  const q = req.query as Record<string, unknown>;
  const v = q[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function parseIntParam(v: string | undefined): number | null {
  if (typeof v !== "string" || v.trim().length === 0) return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseOrder(v: string | undefined): "asc" | "desc" | undefined {
  if (v === "asc" || v === "desc") return v;
  return undefined;
}
