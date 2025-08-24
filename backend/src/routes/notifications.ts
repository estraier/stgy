import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { NotificationService } from "../services/notifications";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { AuthHelpers } from "./authHelpers";

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default function createNotificationRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const notificationService = new NotificationService(pgClient);

  router.get("/feed", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const notifications = await notificationService.listFeed(loginUser.id);
    res.json(notifications);
  });

  router.post("/mark", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const { slot, day, isRead } = req.body ?? {};
    if (typeof slot !== "string" || slot.length === 0) {
      return res.status(400).json({ error: "slot is required" });
    }
    if (!isDay(day)) {
      return res.status(400).json({ error: "day must be YYYY-MM-DD" });
    }
    if (typeof isRead !== "boolean") {
      return res.status(400).json({ error: "isRead must be boolean" });
    }
    await notificationService.markNotification({
      userId: loginUser.id,
      slot,
      day,
      isRead,
    });
    res.status(204).end();
  });

  router.post("/mark-all", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const { isRead } = req.body ?? {};
    if (typeof isRead !== "boolean") {
      return res.status(400).json({ error: "isRead must be boolean" });
    }
    await notificationService.markAllNotifications({
      userId: loginUser.id,
      isRead,
    });
    res.status(204).end();
  });

  return router;
}
