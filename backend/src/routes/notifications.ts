// src/routes/notifications.ts
import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { NotificationService } from "../services/notifications";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { AuthHelpers } from "./authHelpers";

export default function createNotificationRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const notificationService = new NotificationService(pgClient);

  router.get("/feed", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    let newerThan: Date | undefined;
    if (typeof req.query.newerThan === "string") {
      const d = new Date(req.query.newerThan);
      if (Number.isNaN(d.getTime())) {
        return res
          .status(400)
          .json({ error: "newerThan must be a valid ISO8601 date-time string" });
      }
      newerThan = d;
    }
    const notifications = await notificationService.listFeed(loginUser.id, { newerThan });
    if (notifications === null) return res.status(304).end();
    return res.json(notifications);
  });

  router.post("/mark", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const { slot, term, isRead } = req.body ?? {};
    if (typeof slot !== "string" || slot.length === 0) {
      return res.status(400).json({ error: "slot is required" });
    }
    if (typeof term !== "string" || term.length === 0) {
      return res.status(400).json({ error: "term is required" });
    }
    if (typeof isRead !== "boolean") {
      return res.status(400).json({ error: "isRead must be boolean" });
    }
    await notificationService.markNotification({ userId: loginUser.id, slot, term, isRead });
    res.status(204).end();
  });

  router.post("/mark-all", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const { isRead } = req.body ?? {};
    if (typeof isRead !== "boolean") {
      return res.status(400).json({ error: "isRead must be boolean" });
    }
    await notificationService.markAllNotifications({ userId: loginUser.id, isRead });
    res.status(204).end();
  });

  return router;
}
