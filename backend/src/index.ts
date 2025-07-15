import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import Redis from "ioredis";
import createAuthRouter from "./routes/auth";
import createUsersRouter from "./routes/users";
import createPostRouter from "./routes/posts";

const app = express();
app.use(express.json());
app.use(cookieParser());

const pgClient = new Client({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 5432,
});
pgClient.connect();

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD,
});

app.use("/auth", createAuthRouter(pgClient, redis));
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
