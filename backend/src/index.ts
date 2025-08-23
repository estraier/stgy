import { Config } from "./config";
import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import Redis from "ioredis";
import cors from "cors";
import type { StorageService } from "./services/storage";
import createAuthRouter from "./routes/auth";
import createAIModelsRouter from "./routes/aiModels";
import createUsersRouter from "./routes/users";
import createPostRouter from "./routes/posts";
import createSignupRouter from "./routes/signup";
import createMediaRouter from "./routes/media";
import { makeStorageService } from "./services/storageFactory";

const app = express();
app.use(express.json());
app.use(cookieParser());

const pgClient = new Client({
  host: Config.DATABASE_HOST,
  port: Config.DATABASE_PORT,
  user: Config.DATABASE_USER,
  password: Config.DATABASE_PASSWORD,
  database: Config.DATABASE_NAME,
});
pgClient.connect();

const redis = new Redis({
  host: Config.REDIS_HOST,
  port: Config.REDIS_PORT,
  password: Config.REDIS_PASSWORD,
});

const storage = makeStorageService(Config.STORAGE_DRIVER);

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
app.use("/users", createUsersRouter(pgClient, redis, storage));
app.use("/posts", createPostRouter(pgClient, redis));
app.use("/media", createMediaRouter(pgClient, redis, storage));

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error("[API ERROR]", err);
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
    console.log(`[config] ${key}: ${JSON.stringify(value)}`);
  });
  console.log(`Server running on http://${Config.BACKEND_HOST}:${Config.BACKEND_PORT}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals | "SIGUSR2") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] Received ${signal}. Closing server...`);
  server.close((err?: Error) => {
    if (err) {
      console.error("[shutdown] HTTP server close error:", err);
      process.exit(1);
    }
    Promise.resolve()
      .then(async () => {
        try {
          console.log("[shutdown] Closing PostgreSQL...");
          await pgClient.end();
        } catch (e) {
          console.error("[shutdown] pgClient.end error:", e);
        }
      })
      .then(async () => {
        try {
          console.log("[shutdown] Closing Redis...");
          await redis.quit();
        } catch (e) {
          console.error("[shutdown] redis.quit error:", e);
        }
      })
      .finally(() => {
        console.log("[shutdown] Done. Bye.");
        process.exit(0);
      });
  });
  setTimeout(() => {
    console.warn("[shutdown] Force exiting after 10s");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.once("SIGUSR2", () => {
  shutdown("SIGUSR2");
  setTimeout(() => process.kill(process.pid, "SIGUSR2"), 500);
});
