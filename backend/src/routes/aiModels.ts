import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AIModelsService } from "../services/aiModels";
import { AuthHelpers } from "./authHelpers";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";

export default function createAIModelsRouter(pgPool: Pool, redis: Redis) {
  const router = Router();

  const aiModelsService = new AIModelsService(pgPool);
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "db",
    Config.DAILY_DB_TIMER_LIMIT_MS,
  );

  router.get("/:label", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const model = await aiModelsService.getAIModel(req.params.label);
    watch.done();
    if (!model) return res.status(404).json({ error: "not found" });
    res.json(model);
  });

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.requireLogin(req, res);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }
    const watch = timerThrottleService.startWatch(loginUser);
    const models = await aiModelsService.listAIModels();
    watch.done();
    res.json(models);
  });

  return router;
}
