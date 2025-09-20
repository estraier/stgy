import pino, { type Logger, type LoggerOptions } from "pino";

const isProd = process.env.NODE_ENV === "production";

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            singleLine: true,
          },
        },
      }),
};

function build(): Logger {
  return pino(options);
}

type GlobalWithLogger = typeof globalThis & { __STGY_LOGGER__?: Logger };
const g = globalThis as GlobalWithLogger;

export const logger: Logger = g.__STGY_LOGGER__ ?? (g.__STGY_LOGGER__ = build());
export const createLogger = (bindings: Record<string, unknown>): Logger => logger.child(bindings);
