import { jest } from "@jest/globals";
import type { Transporter } from "nodemailer";
import { processNextMailTask, recoverProcessingQueue } from "./mailWorker";
import type { SendMailService } from "./services/sendMail";

function makeRedisMock() {
  const transaction: any = {
    lrem: jest.fn(),
    lpush: jest.fn(),
    exec: jest.fn(),
  };
  transaction.lrem.mockReturnValue(transaction);
  transaction.lpush.mockReturnValue(transaction);
  transaction.exec.mockResolvedValue([] as never);

  return {
    brpoplpush: jest.fn(),
    lrem: jest.fn(),
    rpoplpush: jest.fn(),
    multi: jest.fn(() => transaction),
    transaction,
  } as any;
}

function makeSendMailServiceMock() {
  return {
    canSendMail: jest.fn(),
    send: jest.fn(),
    recordSend: jest.fn(),
  } as any;
}

const queue = "mail-queue";
const processingQueue = "mail-queue:processing";
const transporter = {} as Transporter;

describe("mail worker queue handling", () => {
  test("removes a task from the processing queue after Postfix accepts it", async () => {
    const payload = JSON.stringify({
      type: "signup",
      email: "user@example.com",
      verificationCode: "123456",
    });
    const redis = makeRedisMock();
    redis.brpoplpush.mockResolvedValue(payload as never);
    redis.lrem.mockResolvedValue(1 as never);

    const sendMailService = makeSendMailServiceMock();
    sendMailService.canSendMail.mockResolvedValue({ ok: true } as never);
    sendMailService.send.mockResolvedValue(undefined as never);
    sendMailService.recordSend.mockResolvedValue(undefined as never);

    await expect(
      processNextMailTask(
        queue,
        processingQueue,
        redis as any,
        sendMailService as unknown as SendMailService,
        transporter,
      ),
    ).resolves.toBe(true);

    expect(redis.brpoplpush).toHaveBeenCalledWith(queue, processingQueue, 5);
    expect(sendMailService.send).toHaveBeenCalledTimes(1);
    expect(redis.lrem).toHaveBeenCalledWith(processingQueue, 1, payload);
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test("returns a task to the queue when SMTP submission fails", async () => {
    const payload = JSON.stringify({
      type: "signup",
      email: "user@example.com",
      verificationCode: "123456",
    });
    const redis = makeRedisMock();
    redis.brpoplpush.mockResolvedValue(payload as never);

    const sendMailService = makeSendMailServiceMock();
    sendMailService.canSendMail.mockResolvedValue({ ok: true } as never);
    sendMailService.send.mockRejectedValue(new Error("SMTP unavailable") as never);

    await expect(
      processNextMailTask(
        queue,
        processingQueue,
        redis as any,
        sendMailService as unknown as SendMailService,
        transporter,
      ),
    ).rejects.toThrow("SMTP unavailable");

    expect(redis.transaction.lrem).toHaveBeenCalledWith(processingQueue, 1, payload);
    expect(redis.transaction.lpush).toHaveBeenCalledWith(queue, payload);
    expect(redis.transaction.exec).toHaveBeenCalledTimes(1);
  });

  test("restores unfinished tasks when the worker starts", async () => {
    const redis = makeRedisMock();
    redis.rpoplpush
      .mockResolvedValueOnce("task-1" as never)
      .mockResolvedValueOnce("task-2" as never)
      .mockResolvedValueOnce(null as never);

    await expect(recoverProcessingQueue(queue, processingQueue, redis as any)).resolves.toBe(2);
    expect(redis.rpoplpush).toHaveBeenCalledTimes(3);
    expect(redis.rpoplpush).toHaveBeenCalledWith(processingQueue, queue);
  });
});
