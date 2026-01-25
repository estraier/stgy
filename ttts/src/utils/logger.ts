import { Config } from "../config";
import pino, { stdTimeFunctions, type Logger, type LoggerOptions } from "pino";
import { Writable } from "stream";

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: stdTimeFunctions.isoTime,
  base: undefined,
  formatters: {
    level(label) {
      return { level: label.toUpperCase() };
    },
  },
};

type LogObject = {
  level?: string;
  time?: string;
  msg?: string;
  file?: string;
  [key: string]: unknown;
};

class DevPrettyStream extends Writable {
  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const text = chunk.toString("utf8").trim();
    if (text.length > 0) {
      try {
        const obj = JSON.parse(text) as LogObject;
        const level = typeof obj.level === "string" ? obj.level : "";
        const time = (typeof obj.time === "string" ? obj.time : "").replace(/\..*/, "");
        const file = (typeof obj.file === "string" ? obj.file : "").slice(0, 9);
        const msg = typeof obj.msg === "string" ? obj.msg : text;
        const line = `${level.padEnd(5)} ${time} ${file.padEnd(10)} ${msg}\n`;
        process.stdout.write(line);
      } catch {
        process.stdout.write(text + "\n");
      }
    }
    callback();
  }
}

function build(): Logger {
  if (Config.LOG_FORMAT === "simple") {
    const devStream = new DevPrettyStream();
    return pino(options, devStream);
  }
  return pino(options);
}

type GlobalWithLogger = typeof globalThis & { __STGY_LOGGER__?: Logger };
const g = globalThis as GlobalWithLogger;

export const logger: Logger = g.__STGY_LOGGER__ ?? (g.__STGY_LOGGER__ = build());
export const createLogger = (bindings: Record<string, unknown>): Logger => logger.child(bindings);
