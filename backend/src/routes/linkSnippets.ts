import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { AuthService } from "../services/auth";
import {
  LinkSnippetInputError,
  LinkSnippetRateLimitError,
  LinkSnippetsService,
} from "../services/linkSnippets";
import { UsersService } from "../services/users";
import { AuthHelpers } from "./authHelpers";

export default function createLinkSnippetsRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const service = new LinkSnippetsService(pgPool, redis);
  const authHelpers = new AuthHelpers(
    new AuthService(pgPool, redis),
    new UsersService(pgPool, redis),
  );

  router.post("/resolve", async (req: Request, res: Response) => {
    const url = typeof req.body?.url === "string" ? req.body.url : "";
    const actorKey = req.ip || req.socket.remoteAddress || "unknown";
    if (!url.trim()) {
      return res.status(400).json({ error: "url is required" });
    }

    try {
      const viewer = await authHelpers.getCurrentUser(req);
      const result = await service.resolve(url, actorKey, viewer?.id);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof LinkSnippetInputError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof LinkSnippetRateLimitError) {
        return res.status(429).json({ error: error.message });
      }
      throw error;
    }
  });

  return router;
}
