import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { GeoCoder } from "stgy-geocoder";
import type { StorageService } from "../services/storage";
import type { EventLogService } from "../services/eventLog";
import type { AuthenticatedUser } from "../models/session";
import type { User } from "../models/user";
import { AuthHelpers } from "./authHelpers";
import { AuthService } from "../services/auth";
import { DailyTimerThrottleService } from "../services/throttle";
import { PostsService } from "../services/posts";
import { UsersService } from "../services/users";
import createPostsRouter from "./posts";
import createUsersRouter from "./users";

const frozenUser: AuthenticatedUser = {
  id: "0001000000000001",
  isAdmin: false,
  isFrozen: true,
};

const normalUser: AuthenticatedUser = {
  id: "0001000000000001",
  isAdmin: false,
  isFrozen: false,
};

const adminUser: AuthenticatedUser = {
  id: "0001000000000002",
  isAdmin: true,
  isFrozen: false,
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "0001000000000001",
    nickname: "user",
    avatar: null,
    aiModel: null,
    snippet: "[]",
    isAdmin: false,
    isFrozen: true,
    blockStrangers: false,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T01:00:00.000Z",
    countFollowers: 0,
    countFollowees: 0,
    countPosts: 0,
    ...overrides,
  };
}

describe("frozen user route enforcement", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const pgPool = {} as Pool;
    const redis = {} as Redis;
    const storageService = {} as StorageService;
    const eventLogService = {} as EventLogService;
    const geoCoder = {} as GeoCoder;

    const app = express();
    app.use(express.json());
    app.use("/posts", createPostsRouter(pgPool, redis, storageService, eventLogService));
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

  test("rejects a post creation by a frozen user before calling the service", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(frozenUser);
    const createPost = jest.spyOn(PostsService.prototype, "createPost");

    const response = await fetch(`${baseUrl}/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "blocked", tags: [] }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "user is frozen" });
    expect(createPost).not.toHaveBeenCalled();
  });

  test("does not let a non-administrator change frozen state", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(normalUser);
    jest.spyOn(DailyTimerThrottleService.prototype, "canDo").mockResolvedValue(true);
    const updateUser = jest.spyOn(UsersService.prototype, "updateUser");

    const response = await fetch(`${baseUrl}/users/0001000000000001`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFrozen: true }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden to change isFrozen" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  test("deletes every target session when an administrator changes frozen state", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(adminUser);
    jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done: jest.fn() });
    jest
      .spyOn(UsersService.prototype, "getUserLite")
      .mockResolvedValue(makeUser({ isFrozen: false }));
    const updateUser = jest
      .spyOn(UsersService.prototype, "updateUser")
      .mockResolvedValue(makeUser({ isFrozen: true }));
    const deleteUserSessions = jest
      .spyOn(AuthService.prototype, "deleteUserSessions")
      .mockResolvedValue(2);
    const refreshSessionInfo = jest.spyOn(AuthService.prototype, "refreshSessionInfo");

    const response = await fetch(`${baseUrl}/users/0001000000000001`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFrozen: true }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).isFrozen).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "0001000000000001", isFrozen: true }),
    );
    expect(deleteUserSessions).toHaveBeenCalledWith("0001000000000001");
    expect(refreshSessionInfo).not.toHaveBeenCalled();
  });
  test("keeps target sessions when an administrator submits unchanged authentication state", async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(adminUser);
    jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done: jest.fn() });
    jest
      .spyOn(UsersService.prototype, "getUserLite")
      .mockResolvedValue(makeUser({ isFrozen: true }));
    jest
      .spyOn(UsersService.prototype, "updateUser")
      .mockResolvedValue(makeUser({ isFrozen: true }));
    const deleteUserSessions = jest.spyOn(AuthService.prototype, "deleteUserSessions");

    const response = await fetch(`${baseUrl}/users/0001000000000001`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFrozen: true }),
    });

    expect(response.status).toBe(200);
    expect(deleteUserSessions).not.toHaveBeenCalled();
  });

});
