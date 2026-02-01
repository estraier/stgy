import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { SearchService } from "./services/search";
import express, { ErrorRequestHandler, Request } from "express";
import promBundle from "express-prom-bundle";
import createRootRouter from "./routes/root";
import createResourceRouter from "./routes/resource";

const logger = createLogger({ file: "index" });

type ResourceInstance = {
  searchService: SearchService;
};

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

function printMemoryUsage() {
  logger.info(`[system] Memory usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
}

async function main() {
  logger.info("Starting Search Server...");
  printMemoryUsage();

  const instances = new Map<string, ResourceInstance>();

  for (const resConfig of Config.resources) {
    const { namePrefix } = resConfig;
    logger.info(`Initializing resource: ${namePrefix}`);

    try {
      const searchLogger = createLogger({ file: "search", resource: namePrefix });
      const searchService = new SearchService(resConfig, searchLogger);

      await searchService.open();

      instances.set(namePrefix, {
        searchService,
      });

      logger.info(`Resource [${namePrefix}] is now ready.`);
    } catch (e) {
      logger.error(`Failed to initialize resource [${namePrefix}]: ${e}`);
      throw e;
    }
  }

  const app = express();

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

  app.use(express.json({ limit: Config.INPUT_BODY_LIMIT }));

  app.use("/", createRootRouter());

  for (const [name, inst] of instances.entries()) {
    app.use(`/${name}`, createResourceRouter(inst));
    logger.info(`Routing established for: /${name}`);
  }

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    logger.error(`[API ERROR] ${err}`);
    if (res.headersSent) return next(err);
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: (err as { message?: string }).message || "internal server error",
    });
  };
  app.use(errorHandler);

  const port = Config.SERVER_PORT;
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info(`Search Server running on http://0.0.0.0:${port}`);
    printMemoryUsage();
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[shutdown] Received ${signal}. Closing all resources...`);

    server.close(async (err) => {
      if (err) {
        logger.error(`[shutdown] HTTP server close error: ${err}`);
      }

      for (const [name, inst] of instances.entries()) {
        try {
          logger.info(`[shutdown] Closing SearchService for [${name}]...`);
          await inst.searchService.close();
        } catch (e) {
          logger.error(`[shutdown] Error during closing [${name}]: ${e}`);
        }
      }

      printMemoryUsage();
      logger.info("[shutdown] Cleanup complete. Goodbye.");
      process.exit(0);
    });

    setTimeout(() => {
      logger.warn("[shutdown] Shutdown timed out, force exiting.");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  logger.error(`Fatal error during startup: ${e}`);
  process.exit(1);
});
