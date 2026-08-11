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
import { MediaService } from "../services/media";
import { PostsService } from "../services/posts";
import { TracksService } from "../services/tracks";
import { UsersService } from "../services/users";
import createPostsRouter from "./posts";
import createUsersRouter from "./users";

const adminUser: AuthenticatedUser = {
  id: "0001000000000002",
  isAdmin: true,
  isFrozen: false,
};

function makeUser(id: string, isFrozen = false): User {
  return {
    id,
    nickname: `user-${id}`,
    avatar: null,
    aiModel: null,
    snippet: "[]",
    isAdmin: false,
    isFrozen,
    blockStrangers: false,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: null,
    countFollowers: 0,
    countFollowees: 0,
    countPosts: 0,
  };
}

describe("contents dashboard existing admin routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    jest.spyOn(AuthHelpers.prototype, "getCurrentUser").mockResolvedValue(adminUser);
    jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done: jest.fn() });

    const pgPool = {} as Pool;
    const redis = {} as Redis;
    const storageService = {} as StorageService;
    const eventLogService = {} as EventLogService;
    const geoCoder = {} as GeoCoder;

    const app = express();
    app.use(express.json());
    app.use("/posts", createPostsRouter(pgPool, redis, storageService, eventLogService));
    app.use("/users", createUsersRouter(pgPool, redis, storageService, eventLogService, geoCoder));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("an administrator can delete a post through the existing single-post route", async () => {
    const deletePost = jest.spyOn(PostsService.prototype, "deletePost").mockResolvedValue(undefined);
    const id = "0001000000000101";

    const response = await fetch(`${baseUrl}/posts/${id}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "ok" });
    expect(deletePost).toHaveBeenCalledWith(id);
  });

  test("an administrator can delete a user through the existing single-user route", async () => {
    const id = "0001000000000101";
    const deleteUser = jest.spyOn(UsersService.prototype, "deleteUser").mockResolvedValue(undefined);
    const deleteSessions = jest.spyOn(AuthService.prototype, "deleteUserSessions").mockResolvedValue(1);
    const deleteMedia = jest
      .spyOn(MediaService.prototype, "deleteAllImagesAndProfiles")
      .mockResolvedValue(undefined);
    const deleteTracks = jest
      .spyOn(TracksService.prototype, "deleteAllTracks")
      .mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/users/${id}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "ok" });
    expect(deleteUser).toHaveBeenCalledWith(id);
    expect(deleteSessions).toHaveBeenCalledWith(id);
    expect(deleteMedia).toHaveBeenCalledWith(id);
    expect(deleteTracks).toHaveBeenCalledWith(id);
  });

  test("an administrator can freeze a user through the existing update route", async () => {
    const id = "0001000000000101";
    jest.spyOn(UsersService.prototype, "getUserLite").mockResolvedValue(makeUser(id, false));
    const updateUser = jest
      .spyOn(UsersService.prototype, "updateUser")
      .mockImplementation(async ({ id: userId }) => makeUser(userId, true));
    const deleteSessions = jest.spyOn(AuthService.prototype, "deleteUserSessions").mockResolvedValue(1);

    const response = await fetch(`${baseUrl}/users/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFrozen: true }),
    });

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ id, isFrozen: true }));
    expect(deleteSessions).toHaveBeenCalledWith(id);
  });
});
