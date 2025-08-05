import { Config } from "./config";
import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import Redis from "ioredis";
import cors from "cors";
import createAuthRouter from "./routes/auth";
import createAIModelsRouter from "./routes/aiModels";
import createUsersRouter from "./routes/users";
import createPostRouter from "./routes/posts";
import createSignupRouter from "./routes/signup";

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

app.use(
  cors({
    origin: Config.FRONTEND_ORIGIN,
    credentials: true,
  }),
);

app.use("/auth", createAuthRouter(pgClient, redis));
app.use("/signup", createSignupRouter(pgClient, redis));
app.use("/ai-models", createAIModelsRouter(pgClient, redis));
app.use("/users", createUsersRouter(pgClient, redis));
app.use("/posts", createPostRouter(pgClient, redis));

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error("[API ERROR]", err);
  if (res.headersSent) return next(err);
  const status = (err as { statusCode?: number }).statusCode || 500;
  res.status(status).json({
    error: (err as { message?: string }).message || "internal server error",
    code: (err as { code?: string }).code,
  });
};
app.use(errorHandler);

app.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});
