import { Config } from "../config";
import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import type { GeoCoder } from "stgy-geocoder";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { DailyTimerThrottleService } from "../services/throttle";
import { AuthHelpers } from "./authHelpers";
import type { UserLite } from "../models/user";

export default function createGeoRouter(pgPool: Pool, redis: Redis, geoCoder: GeoCoder) {
  const router = Router();
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);
  const timerThrottleService = new DailyTimerThrottleService(
    redis,
    "geo",
    Config.DAILY_GEO_TIMER_LIMIT_MS,
  );

  router.get("/encode", async (req: Request, res: Response) => {
    const loginUser = await getGeoUser(req, res, authHelpers);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    const locale =
      typeof req.query.locale === "string" && req.query.locale ? req.query.locale : "ja";

    const watch = timerThrottleService.startWatch(loginUser);
    const places = geoCoder.encode(query, locale);
    watch.done();

    if (places.length === 0) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(places);
  });

  router.get("/decode", async (req: Request, res: Response) => {
    const loginUser = await getGeoUser(req, res, authHelpers);
    if (!loginUser) return;
    if (!loginUser.isAdmin && !(await timerThrottleService.canDo(loginUser.id))) {
      return res.status(403).json({ error: "too often operations" });
    }

    const longitude = parseCoordinate(req.query.longitude, "longitude", -180, 180, res);
    if (longitude === undefined) return;
    const latitude = parseCoordinate(req.query.latitude, "latitude", -90, 90, res);
    if (latitude === undefined) return;
    const locale =
      typeof req.query.locale === "string" && req.query.locale ? req.query.locale : "ja";

    const watch = timerThrottleService.startWatch(loginUser);
    const places = geoCoder.decode(longitude, latitude, locale);
    watch.done();

    if (places.length === 0) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(places);
  });

  return router;
}

async function getGeoUser(
  req: Request,
  res: Response,
  authHelpers: AuthHelpers,
): Promise<UserLite | null> {
  if (!authHelpers.getSessionId(req)) {
    return authHelpers.makeDummyUser();
  }
  return await authHelpers.requireLogin(req, res);
}

function parseCoordinate(
  value: unknown,
  name: "longitude" | "latitude",
  minimum: number,
  maximum: number,
  res: Response,
): number | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    res.status(400).json({ error: `${name} is required` });
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    res.status(400).json({ error: `${name} must be a number` });
    return undefined;
  }
  if (number < minimum || number > maximum) {
    res.status(400).json({ error: `${name} must be between ${minimum} and ${maximum}` });
    return undefined;
  }
  return number;
}
