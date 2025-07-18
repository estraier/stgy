import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import * as usersService from "./users";

const SIGNUP_MAIL_QUEUE = "signup_mail_queue";

function generateVerificationCode(): string {
  if (process.env.FAKEBOOK_TEST_SIGNUP_CODE && process.env.FAKEBOOK_TEST_SIGNUP_CODE.length > 0) {
    return process.env.FAKEBOOK_TEST_SIGNUP_CODE;
  }
  return Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
}

function validateEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export async function startSignup(
  email: string,
  password: string,
  redis: Redis
): Promise<{ signupId: string }> {
  if (!email || !validateEmail(email)) throw new Error("Invalid email format.");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
  const signupId = uuidv4();
  const verificationCode = generateVerificationCode();
  const signupKey = `signup:${signupId}`;
  await redis.hmset(signupKey, {
    email,
    password,
    verificationCode,
    createdAt: new Date().toISOString(),
  });
  await redis.expire(signupKey, 900);
  await redis.lpush(SIGNUP_MAIL_QUEUE, JSON.stringify({ email, verificationCode }));
  return { signupId };
}

export async function verifySignup(
  signupId: string,
  code: string,
  redis: Redis,
  pgClient: any
): Promise<{ userId: string }> {
  const signupKey = `signup:${signupId}`;
  const data = await redis.hgetall(signupKey);
  if (!data || !data.email || !data.password || !data.verificationCode)
    throw new Error("Signup info not found or expired.");
  if (data.verificationCode !== code) throw new Error("Verification code mismatch.");
  const input = {
    email: data.email,
    password: data.password,
    nickname: data.email.split("@")[0],
    is_admin: false,
    introduction: "",
    personality: "",
    model: "",
  };
  const user = await usersService.createUser(input, pgClient);
  await redis.del(signupKey);
  return { userId: user.id };
}
