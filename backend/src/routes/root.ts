import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { Config } from "../config";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";

export default function createRootRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/health", async (req: Request, res: Response) => {
    res.status(200).json({ result: "ok" });
  });

  router.get("/metrics/aggregation", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }

    const targets = Config.BACKEND_API_PRIVATE_URL_LIST;
    const results: Record<string, string> = {};

    await Promise.all(
      targets.map(async (baseUrl) => {
        try {
          const metricsUrl = buildMetricsUrl(baseUrl);
          const text = await fetchTextWithTimeout(metricsUrl, 3000);
          results[baseUrl] = text;
        } catch (e) {
          results[baseUrl] = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
        }
      }),
    );

    res.json(results);
  });

  return router;
}

function buildMetricsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  const basePath = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  u.pathname = `${basePath}metrics`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "GET", signal: controller.signal });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${text}`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}
