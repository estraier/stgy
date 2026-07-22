import { createLogger } from "./utils/logger";
import { SendMailService } from "./services/sendMail";
import { connectRedisWithRetry } from "./utils/servers";
import { WorkerLifecycle, runIfMain } from "./utils/workerRunner";
import type Redis from "ioredis";
import type { Transporter } from "nodemailer";

const logger = createLogger({ file: "mailWorker" });
export const lifecycle = new WorkerLifecycle();

type MailTask =
  | { type: "signup"; email: string; verificationCode: string }
  | { type: "update-email"; newEmail: string; verificationCode: string }
  | { type: "reset-password"; email: string; mailCode: string; resetPasswordId: string };

const MAIL_QUEUE = "mail-queue";
const MAIL_PROCESSING_QUEUE = "mail-queue:processing";

async function handleMailTask(
  msg: MailTask,
  sendMailService: SendMailService,
  mailTransporter: Transporter,
) {
  switch (msg.type) {
    case "signup": {
      const subject = "STGY Signup Verification Code";
      const text = `Thank you for signing up for STGY.\nYour verification code: ${msg.verificationCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(sendMailService, mailTransporter, msg.email, subject, text);
      break;
    }
    case "update-email": {
      const subject = "STGY Email Change Verification";
      const text = `Your verification code for email update: ${msg.verificationCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(sendMailService, mailTransporter, msg.newEmail, subject, text);
      break;
    }
    case "reset-password": {
      const subject = "STGY Password Reset Verification";
      const text = `A password reset was requested for your STGY account.\nVerification code: ${msg.mailCode}\nPlease enter this code within 5 minutes.`;
      await sendMailWithRecord(sendMailService, mailTransporter, msg.email, subject, text);
      break;
    }
    default: {
      const _exhaustiveCheck: never = msg;
      logger.warn(`unknown mail type: ${_exhaustiveCheck}`);
    }
  }
}

async function sendMailWithRecord(
  sendMailService: SendMailService,
  mailTransporter: Transporter,
  address: string,
  subject: string,
  body: string,
) {
  const canSend = await sendMailService.canSendMail(address);
  if (!canSend.ok) {
    throw new Error(`throttle: cannot send to ${address}: ${canSend.reason}`);
  }

  await sendMailService.send(mailTransporter, address, subject, body);

  try {
    await sendMailService.recordSend(address);
  } catch (e) {
    logger.warn(`sent mail to ${address}, but failed to record send history: ${e}`);
  }
  logger.info(`sent mail to ${address} [${subject}]`);
}

async function requeueMailTask(
  queue: string,
  processingQueue: string,
  redis: Redis,
  payload: string,
): Promise<void> {
  await redis.multi().lrem(processingQueue, 1, payload).lpush(queue, payload).exec();
}

export async function processNextMailTask(
  queue: string,
  processingQueue: string,
  redis: Redis,
  sendMailService: SendMailService,
  mailTransporter: Transporter,
): Promise<boolean> {
  const payload = await redis.brpoplpush(queue, processingQueue, 5);
  if (!payload) return false;

  try {
    let msg: unknown;
    try {
      msg = JSON.parse(payload);
    } catch {
      logger.error(`invalid payload in ${queue}: ${payload}`);
      await redis.lrem(processingQueue, 1, payload);
      return true;
    }

    if (typeof msg === "object" && msg !== null && "type" in msg) {
      await handleMailTask(msg as MailTask, sendMailService, mailTransporter);
    } else {
      logger.error(`invalid task object in ${queue}: ${payload}`);
    }

    await redis.lrem(processingQueue, 1, payload);
    return true;
  } catch (e) {
    try {
      await requeueMailTask(queue, processingQueue, redis, payload);
    } catch (requeueError) {
      logger.error(`failed to return mail task to ${queue}: ${requeueError}`);
    }
    throw e;
  }
}

export async function recoverProcessingQueue(
  queue: string,
  processingQueue: string,
  redis: Redis,
): Promise<number> {
  let recovered = 0;
  while (await redis.rpoplpush(processingQueue, queue)) {
    recovered += 1;
  }
  return recovered;
}

async function processQueue(
  queue: string,
  processingQueue: string,
  redis: Redis,
  sendMailService: SendMailService,
  mailTransporter: Transporter,
) {
  while (lifecycle.isActive) {
    try {
      await processNextMailTask(
        queue,
        processingQueue,
        redis,
        sendMailService,
        mailTransporter,
      );
    } catch (e) {
      if (!lifecycle.isActive) break;
      logger.error(`error processing ${queue}; task returned to queue: ${e}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export async function startMailWorker() {
  logger.info("STGY mail worker started");
  const redis = await connectRedisWithRetry();
  const sendMailService = new SendMailService(redis);
  const mailTransporter: Transporter = SendMailService.createTransport();

  try {
    const recovered = await recoverProcessingQueue(MAIL_QUEUE, MAIL_PROCESSING_QUEUE, redis);
    if (recovered > 0) {
      logger.warn(`returned ${recovered} unfinished mail task(s) to ${MAIL_QUEUE}`);
    }
    await processQueue(
      MAIL_QUEUE,
      MAIL_PROCESSING_QUEUE,
      redis,
      sendMailService,
      mailTransporter,
    );
  } finally {
    logger.info("Stopping mail worker, disconnecting redis...");
    try {
      redis.disconnect();
    } catch (e) {
      logger.error(`Redis disconnect error: ${e}`);
    }
  }
}

runIfMain(module, startMailWorker, logger, lifecycle);
