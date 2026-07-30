import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { GeoCoder } from "stgy-geocoder";
import type { StorageService } from "../services/storage";
import type { EventLogService } from "../services/eventLog";
import type { UserLite } from "../models/user";
import { AuthHelpers } from "./authHelpers";
import { DailyTimerThrottleService } from "../services/throttle";
import { PostsService } from "../services/posts";
import { UsersService } from "../services/users";
import createPostsRouter from "./posts";
import createUsersRouter from "./users";

const nonAdminUser = {
  id: "0001000000000001",
  isAdmin: false,
} as UserLite;

const adminUser = {
  id: "0001000000000002",
  isAdmin: true,
} as UserLite;

describe("admin-only count and direct query list routes", () => {
  let server: Server;
  let baseUrl: string;
  let currentUser: UserLite;
  let canDo: jest.SpyInstance;
  let countPosts: jest.SpyInstance;
  let listPosts: jest.SpyInstance;
  let countUsers: jest.SpyInstance;
  let listUsers: jest.SpyInstance;

  beforeEach(async () => {
    currentUser = nonAdminUser;
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockImplementation(async () => currentUser);
    canDo = jest.spyOn(DailyTimerThrottleService.prototype, "canDo").mockResolvedValue(true);
    jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done: jest.fn() });
    countPosts = jest.spyOn(PostsService.prototype, "countPosts").mockResolvedValue(7);
    listPosts = jest.spyOn(PostsService.prototype, "listPosts").mockResolvedValue([]);
    countUsers = jest.spyOn(UsersService.prototype, "countUsers").mockResolvedValue(11);
    listUsers = jest.spyOn(UsersService.prototype, "listUsers").mockResolvedValue([]);

    const pgPool = {} as Pool;
    const redis = {} as Redis;
    const storageService = {} as StorageService;
    const eventLogService = {} as EventLogService;
    const geoCoder = {} as GeoCoder;

    const app = express();
    app.use(
      "/posts",
      createPostsRouter(pgPool, redis, storageService, eventLogService),
    );
    app.use(
      "/users",
      createUsersRouter(pgPool, redis, storageService, eventLogService, geoCoder),
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

  test.each([
    ["/posts/count", "posts"],
    ["/users/count", "users"],
  ])("rejects non-admin count access: %s", async (path, service) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "admin only" });
    expect(canDo).not.toHaveBeenCalled();
    if (service === "posts") expect(countPosts).not.toHaveBeenCalled();
    else expect(countUsers).not.toHaveBeenCalled();
  });

  test.each([
    ["/posts?query=needle", "posts"],
    ["/users?query=needle", "users"],
  ])("rejects a direct query list for non-admins: %s", async (path, service) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "admin only" });
    expect(canDo).not.toHaveBeenCalled();
    if (service === "posts") expect(listPosts).not.toHaveBeenCalled();
    else expect(listUsers).not.toHaveBeenCalled();
  });

  test.each([
    ["/posts", "posts"],
    ["/users", "users"],
    ["/posts?query=%20%20", "posts"],
    ["/users?query=%20%20", "users"],
  ])("keeps non-query lists available to non-admins: %s", async (path, service) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(canDo).toHaveBeenCalledWith(nonAdminUser.id);
    if (service === "posts") expect(listPosts).toHaveBeenCalledTimes(1);
    else expect(listUsers).toHaveBeenCalledTimes(1);
  });

  test("allows an admin to use count and direct query list routes", async () => {
    currentUser = adminUser;

    const responses = await Promise.all([
      fetch(`${baseUrl}/posts/count`),
      fetch(`${baseUrl}/users/count`),
      fetch(`${baseUrl}/posts?query=needle`),
      fetch(`${baseUrl}/users?query=needle`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(await responses[0].json()).toEqual({ count: 7 });
    expect(await responses[1].json()).toEqual({ count: 11 });
    expect(await responses[2].json()).toEqual([]);
    expect(await responses[3].json()).toEqual([]);
    expect(countPosts).toHaveBeenCalledTimes(1);
    expect(countUsers).toHaveBeenCalledTimes(1);
    expect(listPosts).toHaveBeenCalledWith(
      expect.objectContaining({ query: "needle" }),
      undefined,
    );
    expect(listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ query: "needle" }),
      undefined,
    );
    expect(canDo).not.toHaveBeenCalled();
  });
});
