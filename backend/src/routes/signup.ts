import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { UsersService } from "../services/users";
import { SignupService } from "../services/signup";

export default function createSignupRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient);
  const signupService = new SignupService(usersService, redis);

  router.post("/start", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are needed" });
    }
    try {
      const { signupId } = await signupService.startSignup(email, password);
      res.status(201).json({ signup_id: signupId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "signup failed" });
    }
  });

  router.post("/verify", async (req: Request, res: Response) => {
    const { signup_id, verification_code } = req.body;
    if (!signup_id || !verification_code) {
      return res.status(400).json({ error: "signup_id and verification_code are needed" });
    }
    try {
      const { userId } = await signupService.verifySignup(signup_id, verification_code);
      res.status(201).json({ user_id: userId });  // ← 201に変更
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "verification failed" });
    }
  });

  return router;
}
