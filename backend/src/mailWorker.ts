import { SendMailService } from "./services/sendMail";
import { makeRedis } from "./utils/servers";

type MailTask =
  | { type: "signup"; email: string; verificationCode: string }
  | { type: "update-email"; newEmail: string; verificationCode: string }
  | { type: "reset-password"; email: string; mailCode: string; resetPasswordId: string };

const MAIL_QUEUE = "mail-queue";

const redis = makeRedis();

const sendMailService = new SendMailService(redis);
const mailTransporter = SendMailService.createTransport();

async function handleMailTask(msg: MailTask) {
  switch (msg.type) {
    case "signup": {
      const subject = "Fakebook Signup Verification Code";
      const text = `Thank you for signing up for Fakebook.\nYour verification code: ${msg.verificationCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(msg.email, subject, text);
      break;
    }
    case "update-email": {
      const subject = "Fakebook Email Change Verification";
      const text = `Your verification code for email update: ${msg.verificationCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(msg.newEmail, subject, text);
      break;
    }
    case "reset-password": {
      const subject = "Fakebook Password Reset Verification";
      const text = `A password reset was requested for your Fakebook account.\nVerification code: ${msg.mailCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(msg.email, subject, text);
      break;
    }
    default: {
      const _exhaustiveCheck: never = msg;
      console.log("[mailworker] unknown mail type:", _exhaustiveCheck);
    }
  }
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

async function processQueue(queue: string) {
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
      if (typeof msg === "object" && msg !== null && "type" in msg) {
        await handleMailTask(msg as MailTask);
      } else {
        console.log(`[mailworker] invalid task object in ${queue}:`, payload);
      }
    } catch (e) {
      console.log(`[mailworker] error processing ${queue}:`, e);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  console.log("[mailworker] Fakebook mail worker started");
  await processQueue(MAIL_QUEUE);
}

main().catch((e) => {
  console.log("[mailworker] Fatal error:", e);
  process.exit(1);
});
