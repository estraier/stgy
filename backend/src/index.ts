import { Config } from "./config";
import { createLogger } from "./utils/logger";
import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { EventLogService } from "./services/eventLog";
import { makeStorageService } from "./services/storageFactory";
import createAuthRouter from "./routes/auth";
import createAIModelsRouter from "./routes/aiModels";
import createUsersRouter from "./routes/users";
import createPostsRouter from "./routes/posts";
import createSignupRouter from "./routes/signup";
import createMediaRouter from "./routes/media";
import createNotificationsRouter from "./routes/notifications";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";

const logger = createLogger({ file: "index" });

async function main() {
  const pgClient = await connectPgWithRetry();
  const redis = await connectRedisWithRetry();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const storageService = makeStorageService(Config.STORAGE_DRIVER);
  const eventLogService = new EventLogService(pgClient, redis);

  app.use(
    cors({
      origin: Config.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );
  if (Config.TRUST_PROXY_HOPS > 0) {
    app.set("trust proxy", Config.TRUST_PROXY_HOPS);
  }

  app.use("/auth", createAuthRouter(pgClient, redis));
  app.use("/signup", createSignupRouter(pgClient, redis));
  app.use("/ai-models", createAIModelsRouter(pgClient, redis));
  app.use("/users", createUsersRouter(pgClient, redis, storageService, eventLogService));
  app.use("/posts", createPostsRouter(pgClient, redis, storageService, eventLogService));
  app.use("/media", createMediaRouter(pgClient, redis, storageService));
  app.use("/notifications", createNotificationsRouter(pgClient, redis));

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    logger.error(`[API ERROR] ${err}`);
    if (res.headersSent) return next(err);
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: (err as { message?: string }).message || "internal server error",
    });
  };
  app.use(errorHandler);

  const server = app.listen(Config.BACKEND_PORT, () => {
    Object.entries(Config).forEach(([key, value]) => {
      if (key.endsWith("_PASSWORD")) {
        value = "****";
      }
      logger.info(`[config] ${key}: ${JSON.stringify(value)}`);
    });
    logger.info(`Server running on http://${Config.BACKEND_HOST}:${Config.BACKEND_PORT}`);
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
            logger.info("[shutdown] Closing PostgreSQL...");
            await pgClient.end();
          } catch (e) {
            logger.error(`[shutdown] pgClient.end error: ${e}`);
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
  logger.info(`[api] Fatal error: ${e}`);
  process.exit(1);
});
