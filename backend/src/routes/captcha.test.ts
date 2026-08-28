import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type Redis from "ioredis";
import createCaptchaRouter from "./captcha";
import { CaptchaService } from "../services/captcha";
import { MINUTE_HASH_HEADER, makeMinuteHash } from "../utils/minuteHash";

describe("captcha routes", () => {
  let server: Server;
  let baseUrl: string;
  let createChallenge: jest.SpyInstance;
  let verifyChallenge: jest.SpyInstance;

  beforeEach(async () => {
    createChallenge = jest.spyOn(CaptchaService.prototype, "createChallenge").mockResolvedValue({
      id: "abcdefghijklmnop",
      png: Buffer.from("png"),
    });
    verifyChallenge = jest
      .spyOn(CaptchaService.prototype, "verifyChallenge")
      .mockResolvedValue(false);

    const app = express();
    app.use(express.json());
    app.use("/captcha", createCaptchaRouter({} as Redis));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test("rejects challenge requests without X-STGY-MinuteHash before generating an image", async () => {
    const response = await fetch(`${baseUrl}/captcha/challenge`, { method: "POST" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid minute hash" });
    expect(createChallenge).not.toHaveBeenCalled();
  });

  test("accepts a current X-STGY-MinuteHash for challenge generation", async () => {
    const response = await fetch(`${baseUrl}/captcha/challenge`, {
      method: "POST",
      headers: { [MINUTE_HASH_HEADER]: makeMinuteHash() },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challengeId: "abcdefghijklmnop",
      image: `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    });
    expect(createChallenge).toHaveBeenCalledTimes(1);
  });

  test("rejects verify requests without X-STGY-MinuteHash before checking the answer", async () => {
    const response = await fetch(`${baseUrl}/captcha/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: "abcdefghijklmnop", answer: "482731" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid minute hash" });
    expect(verifyChallenge).not.toHaveBeenCalled();
  });
});
