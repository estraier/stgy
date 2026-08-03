import type { Request, Response } from "express";
import { AuthHelpers } from "./authHelpers";
import type { SessionInfo } from "../models/session";

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    userId: "0001000000000001",
    userEmail: "user@example.com",
    userNickname: "user",
    userIsAdmin: false,
    userIsFrozen: false,
    userCreatedAt: "2026-01-01T00:00:00.000Z",
    userUpdatedAt: null,
    userLocale: "ja-JP",
    userTimezone: "Asia/Tokyo",
    loggedInAt: "2026-08-03T00:00:00.000Z",
    requiredAgreementTermId: null,
    ...overrides,
  };
}

function makeResponse() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
}

describe("AuthHelpers", () => {
  test("builds the authenticated user from SessionInfo without reading users", async () => {
    const authService = { getSessionInfo: jest.fn().mockResolvedValue(makeSession()) };
    const usersService = { getUserLite: jest.fn() };
    const helpers = new AuthHelpers(authService as never, usersService as never);
    const req = { cookies: { session_id: "session-1" } } as unknown as Request;

    await expect(helpers.getCurrentUser(req)).resolves.toEqual({
      id: "0001000000000001",
      isAdmin: false,
      isFrozen: false,
    });
    expect(usersService.getUserLite).not.toHaveBeenCalled();
  });

  test("allows a frozen user to authenticate for read operations", async () => {
    const authService = {
      getSessionInfo: jest.fn().mockResolvedValue(makeSession({ userIsFrozen: true })),
    };
    const helpers = new AuthHelpers(authService as never, {} as never);
    const req = { cookies: { session_id: "session-1" } } as unknown as Request;
    const { response, status } = makeResponse();

    await expect(helpers.requireLogin(req, response)).resolves.toEqual({
      id: "0001000000000001",
      isAdmin: false,
      isFrozen: true,
    });
    expect(status).not.toHaveBeenCalled();
  });

  test("rejects updates from a frozen user", async () => {
    const authService = {
      getSessionInfo: jest.fn().mockResolvedValue(makeSession({ userIsFrozen: true })),
    };
    const helpers = new AuthHelpers(authService as never, {} as never);
    const req = { cookies: { session_id: "session-1" } } as unknown as Request;
    const { response, status, json } = makeResponse();

    await expect(helpers.requireWritableUser(req, response)).resolves.toBeNull();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "user is frozen" });
  });

  test("treats an administrator as writable even if the frozen bit is set", async () => {
    const authService = {
      getSessionInfo: jest.fn().mockResolvedValue(
        makeSession({ userIsAdmin: true, userIsFrozen: true }),
      ),
    };
    const helpers = new AuthHelpers(authService as never, {} as never);
    const req = { cookies: { session_id: "session-1" } } as unknown as Request;
    const { response, status } = makeResponse();

    await expect(helpers.requireWritableUser(req, response)).resolves.toEqual({
      id: "0001000000000001",
      isAdmin: true,
      isFrozen: true,
    });
    expect(status).not.toHaveBeenCalled();
  });
});
