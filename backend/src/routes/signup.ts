import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Client } from "pg";
import Redis from "ioredis";
import { UsersService } from "../services/users";
import { SignupService } from "../services/signup";
import { SendMailService } from "../services/sendMail";
import { ThrottleService } from "../services/throttle";
import { validateEmail, normalizeEmail, normalizeText } from "../utils/format";

export default function createSignupRouter(pgClient: Client, redis: Redis) {
  const router = Router();
  const usersService = new UsersService(pgClient, redis);
  const signupService = new SignupService(pgClient, usersService, redis);
  const sendMailService = new SendMailService(redis);
  const throttleService = new ThrottleService(redis, "signup", 3600, Config.HOURLY_SIGNUP_LIMIT);

  router.post("/start", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are needed" });
    }
    if (!validateEmail(email)) {
      throw res.status(400).json({ error: "invalid e-mail address" });
    }
    if (!(await throttleService.canDo("0"))) {
      return res.status(403).json({ error: "too often signups" });
    }
    const normEmail = normalizeEmail(email);
    const normPassword = normalizeText(password) ?? "";
    const check = await sendMailService.canSendMail(normEmail);
    if (!check.ok) {
      return res.status(400).json({ error: check.reason || "too many requests" });
    }
    try {
      const { signupId } = await signupService.startSignup(normEmail, normPassword);
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
    if (!(await throttleService.canDo("0"))) {
      return res.status(403).json({ error: "too often signups" });
    }
    try {
      const { userId } = await signupService.verifySignup(signupId, verificationCode);
      throttleService.recordDone("0");
      res.status(201).json({ userId });
    } catch (e: unknown) {
      res.status(400).json({ error: (e as Error).message || "verification failed" });
    }
  });

  return router;
}
