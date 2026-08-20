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
import { QUERY_HASH_HEADER, makeQueryHash } from "../utils/queryHash";
import { Config } from "../config";

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
    jest.spyOn(PostsService.prototype, "listPubPostsByIds").mockResolvedValue([]);

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

  function queryHashHeaders(path: string): Record<string, string> {
    const url = new URL(path, baseUrl);
    return { [QUERY_HASH_HEADER]: makeQueryHash(url.searchParams) };
  }

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

  test("anonymous search requires the X-STGY-QueryHash header", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(null);

    const response = await fetch(
      `${baseUrl}/posts/search?query=foo&ownedBy=12345`,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid queryhash" });
    expect(search).not.toHaveBeenCalled();
  });

  test("anonymous search rejects an invalid query-hash header", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/posts/search?query=foo&ownedBy=12345`, {
      headers: { [QUERY_HASH_HEADER]: "invalid" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid queryhash" });
    expect(search).not.toHaveBeenCalled();
  });

  test("anonymous search requires an explicit owner", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(null);

    const path = "/posts/search?query=foo&locale=en";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "ownedBy is required" });
    expect(search).not.toHaveBeenCalled();
  });

  test("anonymous search forces owner and published filters", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(null);
    jest.spyOn(Date, "now").mockReturnValue(123456789);

    const path = "/posts/search?query=foo&ownedBy=12345&locale=en";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(200);
    expect(DailyTimerThrottleService.prototype.canDo).toHaveBeenCalledWith(
      "0000000000000000",
    );
    expect(search).toHaveBeenCalledWith({
      query: "foo",
      locale: "en",
      offset: 0,
      limit: Config.SEARCH_LIMIT_MAX,
      timeout: 3,
      labels: ["owner:0000000000012345"],
      numericOp: "lte",
      numericValue: 123456789,
    });
    expect(PostsService.prototype.listPubPostsByIds).toHaveBeenCalledWith(
      [],
      "0000000000012345",
      new Date(123456789).toISOString(),
      { offset: 0, limit: 21, order: "desc" },
    );
  });

  test("anonymous owner:me is rejected", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(null);

    const path = "/posts/search?query=owner%3Ame%20foo&ownedBy=12345";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "owner:me requires login" });
    expect(search).not.toHaveBeenCalled();
  });
});
