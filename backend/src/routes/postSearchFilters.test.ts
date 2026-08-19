import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { StorageService } from "../services/storage";
import type { EventLogService } from "../services/eventLog";
import type { AuthenticatedUser } from "../models/session";
import { AuthHelpers } from "./authHelpers";
import { DailyTimerThrottleService } from "../services/throttle";
import { PostsService } from "../services/posts";
import { SearchService } from "../services/search";
import createPostsRouter from "./posts";

const loginUser: AuthenticatedUser = {
  id: "0000000000000001",
  isAdmin: false,
  isFrozen: false,
};

describe("post full-text search filters", () => {
  let server: Server;
  let baseUrl: string;
  let search: jest.SpyInstance;

  beforeEach(async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(loginUser);
    jest.spyOn(DailyTimerThrottleService.prototype, "canDo").mockResolvedValue(true);
    jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done: jest.fn() });
    search = jest.spyOn(SearchService.prototype, "search").mockResolvedValue([]);
    jest.spyOn(PostsService.prototype, "listPostsByIds").mockResolvedValue([]);

    const redis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue("OK"),
    } as unknown as Redis;
    const app = express();
    app.use(
      "/posts",
      createPostsRouter(
        {} as Pool,
        redis,
        {} as StorageService,
        {} as EventLogService,
      ),
    );
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("maps owner and published status tokens to generic TTTS filters", async () => {
    jest.spyOn(Date, "now").mockReturnValue(123456789);

    const response = await fetch(
      `${baseUrl}/posts/search?query=${encodeURIComponent(
        "owner:12345 status:published foo bar",
      )}&locale=en`,
    );

    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      query: "foo bar",
      locale: "en",
      offset: 0,
      limit: 21,
      timeout: 3,
      labels: ["owner:0000000000012345"],
      numericOp: "lte",
      numericValue: 123456789,
    });
  });

  test("resolves owner:me to the logged-in user", async () => {
    const response = await fetch(
      `${baseUrl}/posts/search?query=${encodeURIComponent("owner:me foo")}&locale=en`,
    );

    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      query: "foo",
      locale: "en",
      offset: 0,
      limit: 21,
      timeout: 3,
      labels: ["owner:0000000000000001"],
      numericOp: undefined,
      numericValue: undefined,
    });
  });

  test.each([
    "owner:12345",
    "owner:me",
    "status:published",
    "owner:12345 status:published",
  ])("rejects filter-only post search: %s", async (query) => {
    const response = await fetch(
      `${baseUrl}/posts/search?query=${encodeURIComponent(query)}&locale=en`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "search term is required" });
    expect(search).not.toHaveBeenCalled();
  });

  test("rejects conflicting owner filters", async () => {
    const response = await fetch(
      `${baseUrl}/posts/search?query=${encodeURIComponent("owner:1 foo")}&ownedBy=2`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "conflicting owner filters" });
    expect(search).not.toHaveBeenCalled();
  });
});
