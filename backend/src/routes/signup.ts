import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { UsersService } from "../services/users";
import { SignupService } from "../services/signup";
import { SendMailService } from "../services/sendMail";

export default function createSignupRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const signupService = new SignupService(usersService, redis);
  const sendMailService = new SendMailService(redis);

  router.post("/start", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are needed" });
    }
    const check = await sendMailService.canSendMail(email);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const { signupId } = await signupService.startSignup(email, password);
      res.status(201).json({ signupId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "signup failed" });
    }
  });

  router.post("/verify", async (req: Request, res: Response) => {
    const { signupId, verificationCode } = req.body;
    if (!signupId || !verificationCode) {
      return res.status(400).json({ error: "signupId and verificationCode are needed" });
    }
    try {
      const { userId } = await signupService.verifySignup(signupId, verificationCode);
      res.status(201).json({ userId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "verification failed" });
    }
  });

  return router;
}
