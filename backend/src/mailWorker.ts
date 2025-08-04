import Redis from "ioredis";
import { SendMailService } from "./services/sendMail";

const SIGNUP_MAIL_QUEUE = "signup_mail_queue";
const UPDATE_EMAIL_MAIL_QUEUE = "update_email_queue";
const RESET_PASSWORD_MAIL_QUEUE = "reset_password_mail_queue";

const redis = new Redis({
  host: process.env.FAKEBOOK_REDIS_HOST,
  port: process.env.FAKEBOOK_REDIS_PORT ? Number(process.env.FAKEBOOK_REDIS_PORT) : 6379,
  password: process.env.FAKEBOOK_REDIS_PASSWORD,
});

const sendMailService = new SendMailService(redis);
const mailTransporter = SendMailService.createTransport();

async function handleSignup(msg: unknown) {
  const { email, verificationCode } = msg as { email: string; verificationCode: string };

  console.log("dequeue", email);

  const subject = "Fakebook Signup Verification Code";
  const text = `Thank you for signing up for Fakebook.\nYour verification code: ${verificationCode}\nPlease enter this code within 5 minutes.`;
  await sendMailWithRecord(email, subject, text);
}

async function handleUpdateEmail(msg: unknown) {
  const { newEmail, verificationCode } = msg as { newEmail: string; verificationCode: string };
  const subject = "Fakebook Email Change Verification";
  const text = `Your verification code for email update: ${verificationCode}\nPlease enter this code within 5 minutes.`;
  await sendMailWithRecord(newEmail, subject, text);
}

async function handleResetPassword(msg: unknown) {
  const { email, mailCode, resetPasswordId } = msg as { email: string; mailCode: string; resetPasswordId: string };
  const subject = "Fakebook Password Reset Verification";
  const text = `A password reset was requested for your Fakebook account.\nVerification code: ${mailCode}\nPlease enter this code within 5 minutes.`;
  await sendMailWithRecord(email, subject, text);
}

async function sendMailWithRecord(address: string, subject: string, body: string) {
  try {
    const canSend = await sendMailService.canSendMail(address);
    if (!canSend.ok) {
      console.log(`[mailworker] throttle: cannot send to ${address}: ${canSend.reason}`);
      return;
    }
    await sendMailService.send(mailTransporter, address, subject, body);
    await sendMailService.recordSend(address);
    console.log(`[mailworker] sent mail to ${address} [${subject}]`);
  } catch (e) {
    console.log(`[mailworker] failed to send mail to ${address}:`, e);
  }
}

async function processQueue(queue: string, handler: (msg: unknown) => Promise<void>) {
  while (true) {
    try {
      const res = await redis.brpop(queue, 10);
      if (!res) continue;
      const payload = res[1];
      let msg: unknown;
      try {
        msg = JSON.parse(payload);
      } catch {
        console.log(`[mailworker] invalid payload in ${queue}:`, payload);
        continue;
      }
      await handler(msg);
    } catch (e) {
      console.log(`[mailworker] error processing ${queue}:`, e);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  console.log("[mailworker] Fakebook mail worker started");
  await Promise.all([
    processQueue(SIGNUP_MAIL_QUEUE, handleSignup),
    processQueue(UPDATE_EMAIL_MAIL_QUEUE, handleUpdateEmail),
    processQueue(RESET_PASSWORD_MAIL_QUEUE, handleResetPassword),
  ]);
}

main().catch((e) => {
  console.log("[mailworker] Fatal error:", e);
  process.exit(1);
});
