import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AiUsersService } from "../services/aiUsers";
import { UsersService } from "../services/users";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";

export default function createAiUsersRouter(pgPool: Pool, redis: Redis) {
  const router = Router();

  const aiUsersService = new AiUsersService(pgPool, redis);
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const { offset, limit, order } = AuthHelpers.getPageParams(
      req,
      loginUser.isAdmin ? 65535 : Config.MAX_PAGE_LIMIT,
      ["desc", "asc"] as const,
    );

    const watch = timerThrottleService.startWatch(loginUser);
    const users = await aiUsersService.listAiUsers({ offset, limit, order });
    watch.done();
    res.json(users);
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const watch = timerThrottleService.startWatch(loginUser);
    const user = await aiUsersService.getAiUser(req.params.id);
    watch.done();
    if (!user) return res.status(404).json({ error: "not found" });
    res.json(user);
  });

  return router;
}
