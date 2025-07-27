import express, { ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import Redis from "ioredis";
import cors from "cors";
import createAuthRouter from "./routes/auth";
import createAIModelsRouter from "./routes/ai_models";
import createUsersRouter from "./routes/users";
import createPostRouter from "./routes/posts";
import createSignupRouter from "./routes/signup";

const app = express();
app.use(express.json());
app.use(cookieParser());

const pgClient = new Client({
  host: process.env.FAKEBOOK_DATABASE_HOST,
  user: process.env.FAKEBOOK_DATABASE_USER,
  password: process.env.FAKEBOOK_DATABASE_PASSWORD,
  database: process.env.FAKEBOOK_DATABASE_NAME,
  port: process.env.FAKEBOOK_DATABASE_PORT ? Number(process.env.FAKEBOOK_DATABASE_PORT) : 5432,
});
pgClient.connect();

const redis = new Redis({
  host: process.env.FAKEBOOK_REDIS_HOST,
  port: process.env.FAKEBOOK_REDIS_PORT ? Number(process.env.FAKEBOOK_REDIS_PORT) : 6379,
  password: process.env.FAKEBOOK_REDIS_PASSWORD,
});

const frontendOrigin = process.env.FAKEBOOK_FRONTEND_ORIGIN || "http://localhost:3000";
app.use(
  cors({
    origin: frontendOrigin,
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
