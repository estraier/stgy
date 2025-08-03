import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { AIModelsService } from "../services/aiModels";
import { AuthHelpers } from "./authHelpers";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";

export default function createAIModelsRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  const aiModelsService = new AIModelsService(pgClient);
  const usersService = new UsersService(pgClient, redis);
  const authService = new AuthService(pgClient, redis);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/:name", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const model = await aiModelsService.getAIModel(req.params.name);
    if (!model) return res.status(404).json({ error: "not found" });
    res.json(model);
  });

  router.get("/", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser) return res.status(401).json({ error: "login required" });
    const models = await aiModelsService.listAIModels();
    res.json(models);
  });

  return router;
}
