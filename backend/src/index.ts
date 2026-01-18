import { Config } from "./config";
import { createLogger } from "./utils/logger";
import express, { ErrorRequestHandler } from "express";
import type { Request } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import promBundle from "express-prom-bundle";
import { EventLogService } from "./services/eventLog";
import { makeStorageService } from "./services/storageFactory";
import createRootRouter from "./routes/root";
import createDbStatsRouter from "./routes/dbStats";
import createAuthRouter from "./routes/auth";
import createAIModelsRouter from "./routes/aiModels";
import createAIUsersRouter from "./routes/aiUsers";
import createAIPostsRouter from "./routes/aiPosts";
import createUsersRouter from "./routes/users";
import createPostsRouter from "./routes/posts";
import createSignupRouter from "./routes/signup";
import createMediaRouter from "./routes/media";
import createNotificationsRouter from "./routes/notifications";
import { getSampleAddr, connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";

const logger = createLogger({ file: "index" });

function normalizePath(req: Request): string {
  const routePath = req.route?.path;
  const base = req.baseUrl ?? "";
  if (typeof routePath === "string") {
    const safeRoutePath = routePath.includes("*")
      ? routePath.replace(/\*/g, ":wildcard")
      : routePath;
    return `${base}${safeRoutePath}`;
  }
  return `${base}${req.path}`;
}

async function main() {
  Object.entries(Config).forEach(([key, value]) => {
    if (key.endsWith("_PASSWORD") || key.endsWith("_API_KEY")) {
      value = "*".repeat(value.length);
    }
    logger.info(`[config] ${key}: ${JSON.stringify(value)}`);
  });

  const pgPool = await connectPgWithRetry();
  const redis = await connectRedisWithRetry();

  const app = express();
  app.use(express.json({ limit: 1048576 }));
  app.use(cookieParser());

  app.use(
    cors({
      origin: Config.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );

  if (Config.TRUST_PROXY_HOPS > 0) {
    app.set("trust proxy", Config.TRUST_PROXY_HOPS);
  }

  const metricsMiddleware = promBundle({
    includeMethod: true,
    includePath: true,
    normalizePath,
    buckets: [
      0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
      0.9, 1, 2, 4, 8, 16, 32,
    ],
    promClient: {
      collectDefaultMetrics: {},
    },
  });
  app.use(metricsMiddleware);

  const storageService = makeStorageService(Config.STORAGE_DRIVER);
  const eventLogService = new EventLogService(pgPool, redis);

  app.use("/", createRootRouter(pgPool, redis));
  app.use("/auth", createAuthRouter(pgPool, redis));
  app.use("/signup", createSignupRouter(pgPool, redis));
  app.use("/db-stats", createDbStatsRouter(pgPool, redis));
  app.use("/ai-models", createAIModelsRouter(pgPool, redis));
  app.use("/ai-users", createAIUsersRouter(pgPool, redis));
  app.use("/ai-posts", createAIPostsRouter(pgPool, redis, eventLogService));
  app.use("/users", createUsersRouter(pgPool, redis, storageService, eventLogService));
  app.use("/posts", createPostsRouter(pgPool, redis, storageService, eventLogService));
  app.use("/media", createMediaRouter(pgPool, redis, storageService));
  app.use("/notifications", createNotificationsRouter(pgPool, redis));

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    logger.error(`[API ERROR] ${err}`);
    if (res.headersSent) return next(err);
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: (err as { message?: string }).message || "internal server error",
    });
  };
  app.use(errorHandler);

  const server = app.listen(Config.BACKEND_PORT, "0.0.0.0", () => {
    const addr = getSampleAddr();
    logger.info(`Server running on http://${addr}:${Config.BACKEND_PORT}`);
  });

  let shuttingDown = false;
  function shutdown(signal: NodeJS.Signals | "SIGUSR2") {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`\n[shutdown] Received ${signal}. Closing server...`);
    server.close((err?: Error) => {
      if (err) {
        logger.error(`[shutdown] HTTP server close error: ${err}`);
        process.exit(1);
      }
      Promise.resolve()
        .then(async () => {
          try {
            logger.info("[shutdown] Closing PostgreSQL pool...");
            await pgPool.end();
          } catch (e) {
            logger.error(`[shutdown] pgPool.end error: ${e}`);
          }
        })
        .then(async () => {
          try {
            logger.info("[shutdown] Closing Redis...");
            await redis.quit();
          } catch (e) {
            logger.error(`[shutdown] redis.quit error: ${e}`);
          }
        })
        .finally(() => {
          logger.info("[shutdown] Done. Bye.");
          process.exit(0);
        });
    });
    setTimeout(() => {
      logger.warn("[shutdown] Force exiting after 10s");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.once("SIGUSR2", () => {
    shutdown("SIGUSR2");
    setTimeout(() => process.kill(process.pid, "SIGUSR2"), 500);
  });
}

main().catch((e) => {
  logger.info(`Fatal error: ${e}`);
  process.exit(1);
});
