import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { NotificationsService } from "../services/notifications";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";

export default function createNotificationRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );
  const notificationsService = new NotificationsService(pgPool);

  router.get("/feed", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
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
    const watch = timerThrottleService.startWatch(loginUser);
    const notifications = await notificationsService.listFeed(loginUser.id, { newerThan });
    watch.done();
    if (notifications === null) return res.status(304).end();
    return res.json(notifications);
  });

  router.post("/mark", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
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
    const watch = timerThrottleService.startWatch(loginUser);
    await notificationsService.markNotification({ userId: loginUser.id, slot, term, isRead });
    watch.done();
    res.status(204).end();
  });

  router.post("/mark-all", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const { isRead } = req.body ?? {};
    if (typeof isRead !== "boolean") {
      return res.status(400).json({ error: "isRead must be boolean" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    await notificationsService.markAllNotifications({ userId: loginUser.id, isRead });
    watch.done();
    res.status(204).end();
  });

  return router;
}
