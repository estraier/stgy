import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import * as signupService from "../services/signup";

export default function createSignupRouter(pgClient: Client, redis: Redis) {
  const router = Router();

  router.post("/start", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    try {
      const result = await signupService.startSignup(email, password, redis);
      res.status(201).json({ signup_id: result.signupId });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.post("/verify", async (req: Request, res: Response) => {
    const { signup_id, verification_code } = req.body;
    try {
      const result= await signupService.verifySignup(signup_id, verification_code, redis, pgClient);
      res.status(201).json({ user_id: result.userId });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
