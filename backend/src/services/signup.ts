import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { UsersService } from "./users";
import { generateVerificationCode, validateEmail } from "../utils/format";

const SIGNUP_MAIL_QUEUE = "signup_mail_queue";

export class SignupService {
  usersService: UsersService;
  redis: Redis;

  constructor(usersService: UsersService, redis: Redis) {
    this.usersService = usersService;
    this.redis = redis;
  }

  async startSignup(email: string, password: string): Promise<{ signupId: string }> {
    if (!email || !validateEmail(email)) throw new Error("Invalid email format.");
    if (!password || password.length < 6)
      throw new Error("Password must be at least 6 characters.");
    const signupId = uuidv4();
    const verificationCode = generateVerificationCode();
    const signupKey = `signup:${signupId}`;
    await this.redis.hmset(signupKey, {
      email,
      password,
      verificationCode,
      createdAt: new Date().toISOString(),
    });
    await this.redis.expire(signupKey, 900);
    await this.redis.lpush(SIGNUP_MAIL_QUEUE, JSON.stringify({ email, verificationCode }));
    return { signupId };
  }

  async verifySignup(signupId: string, code: string): Promise<{ userId: string }> {
    const signupKey = `signup:${signupId}`;
    const data = await this.redis.hgetall(signupKey);
    if (!data || !data.email || !data.password || !data.verificationCode)
      throw new Error("Signup info not found or expired.");
    if (data.verificationCode !== code) throw new Error("Verification code mismatch.");
    const input = {
      email: data.email,
      password: data.password,
      nickname: data.email.split("@")[0],
      isAdmin: false,
      introduction: "brand new user",
      aiModel: null,
      aiPersonality: null,
    };
    const user = await this.usersService.createUser(input);
    await this.redis.del(signupKey);
    return { userId: user.id };
  }
}
