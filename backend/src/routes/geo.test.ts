import type { AddressInfo } from "net";
import type { Server } from "http";
import express from "express";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { GeoCoder, GeoPlace } from "stgy-geocoder";
import createGeoRouter from "./geo";
import { AuthHelpers } from "./authHelpers";
import { DailyTimerThrottleService } from "../services/throttle";
import type { AuthenticatedUser } from "../models/session";
import { QUERY_HASH_HEADER, makeQueryHash } from "../utils/queryHash";

const loginUser: AuthenticatedUser = {
  id: "user-1",
  isAdmin: false,
  isFrozen: false,
};

const dummyUser: AuthenticatedUser = {
  id: "0000000000000000",
  isAdmin: false,
  isFrozen: false,
};

function queryHashHeaders(path: string): Record<string, string> {
  const url = new URL(path, "http://localhost");
  return { [QUERY_HASH_HEADER]: makeQueryHash(url.searchParams) };
}

const place: GeoPlace = {
  level: 3,
  kind: "municipality",
  country: "JP",
  longitude: 139.461129,
  latitude: 35.803146,
  addresses: [
    {
      locale: "ja",
      label: "日本埼玉県所沢市",
      elements: ["日本", "埼玉県", "所沢市"],
    },
  ],
};

describe("geo routes", () => {
  let server: Server;
  let baseUrl: string;
  let encode: jest.Mock;
  let decode: jest.Mock;
  let getSessionId: jest.SpyInstance;
  let getCurrentUser: jest.SpyInstance;
  let canDo: jest.SpyInstance;
  let startWatch: jest.SpyInstance;
  let done: jest.Mock;

  beforeEach(async () => {
    encode = jest.fn();
    decode = jest.fn();
    done = jest.fn();

    getSessionId = jest
      .spyOn(AuthHelpers.prototype, "getSessionId")
      .mockReturnValue("session-1");
    getCurrentUser = jest
      .spyOn(AuthHelpers.prototype, "getCurrentUser")
      .mockResolvedValue(loginUser);
    canDo = jest.spyOn(DailyTimerThrottleService.prototype, "canDo").mockResolvedValue(true);
    startWatch = jest
      .spyOn(DailyTimerThrottleService.prototype, "startWatch")
      .mockReturnValue({ done });

    const geoCoder = { encode, decode } as unknown as GeoCoder;
    const app = express();
    app.use("/geo", createGeoRouter({} as Pool, {} as Redis, geoCoder));
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

  test("uses an X-STGY-QueryHash-protected throttled dummy user without a session", async () => {
    getSessionId.mockReturnValue(null);
    encode.mockReturnValue([place]);

    const path = "/geo/encode?query=x";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(canDo).toHaveBeenCalledWith("0000000000000000");
    expect(startWatch).toHaveBeenCalledWith(dummyUser);
  });

  test("rejects an anonymous request without a valid X-STGY-QueryHash header", async () => {
    getSessionId.mockReturnValue(null);

    const response = await fetch(`${baseUrl}/geo/encode?query=x`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid queryhash" });
    expect(canDo).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  test("rejects an anonymous request with an invalid query-hash header", async () => {
    getSessionId.mockReturnValue(null);

    const response = await fetch(`${baseUrl}/geo/encode?query=x`, {
      headers: { [QUERY_HASH_HEADER]: "invalid" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid queryhash" });
    expect(canDo).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  test("falls back from an invalid session to anonymous query-hash header access", async () => {
    getSessionId.mockReturnValue("invalid-session");
    getCurrentUser.mockResolvedValue(null);
    encode.mockReturnValue([place]);

    const path = "/geo/encode?query=x";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(getCurrentUser).toHaveBeenCalled();
    expect(canDo).toHaveBeenCalledWith("0000000000000000");
    expect(startWatch).toHaveBeenCalledWith(dummyUser);
  });

  test("applies geo timer throttling", async () => {
    canDo.mockResolvedValue(false);

    const response = await fetch(`${baseUrl}/geo/encode?query=x`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "too often operations" });
    expect(encode).not.toHaveBeenCalled();
  });

  test("encodes a place and leaves the default locale to GeoCoder", async () => {
    encode.mockReturnValue([place]);

    const response = await fetch(
      `${baseUrl}/geo/encode?query=${encodeURIComponent("埼玉県所沢市")}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(encode).toHaveBeenCalledWith("埼玉県所沢市", undefined);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("rejects a missing encode query", async () => {
    const response = await fetch(`${baseUrl}/geo/encode`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "query is required" });
    expect(encode).not.toHaveBeenCalled();
  });

  test("returns 404 when encode has no match", async () => {
    encode.mockReturnValue([]);

    const response = await fetch(`${baseUrl}/geo/encode?query=unknown`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("decodes coordinates", async () => {
    decode.mockReturnValue([place]);

    const response = await fetch(
      `${baseUrl}/geo/decode?longitude=139.46&latitude=35.80&locale=ja`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(decode).toHaveBeenCalledWith(139.46, 35.8, "ja");
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("allows anonymous decode with a valid query-hash header", async () => {
    getSessionId.mockReturnValue(null);
    decode.mockReturnValue([place]);

    const path = "/geo/decode?longitude=139.46&latitude=35.80&locale=ja";
    const response = await fetch(`${baseUrl}${path}`, { headers: queryHashHeaders(path) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(canDo).toHaveBeenCalledWith("0000000000000000");
    expect(startWatch).toHaveBeenCalledWith(dummyUser);
  });

  test("leaves the default decode locale to GeoCoder", async () => {
    decode.mockReturnValue([place]);

    const response = await fetch(
      `${baseUrl}/geo/decode?longitude=139.46&latitude=35.80`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([place]);
    expect(decode).toHaveBeenCalledWith(139.46, 35.8, undefined);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["/geo/decode?latitude=35", { error: "longitude is required" }],
    ["/geo/decode?longitude=x&latitude=35", { error: "longitude must be a number" }],
    [
      "/geo/decode?longitude=181&latitude=35",
      { error: "longitude must be between -180 and 180" },
    ],
    ["/geo/decode?longitude=139", { error: "latitude is required" }],
    ["/geo/decode?longitude=139&latitude=x", { error: "latitude must be a number" }],
    [
      "/geo/decode?longitude=139&latitude=91",
      { error: "latitude must be between -90 and 90" },
    ],
  ])("validates decode coordinates: %s", async (path, expected) => {
    const response = await fetch(`${baseUrl}${path}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expected);
    expect(decode).not.toHaveBeenCalled();
  });
});
