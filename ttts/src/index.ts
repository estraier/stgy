import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";
import { UpdateWorker } from "./updateWorker";
import express, { ErrorRequestHandler } from "express";
import createRootRouter from "./routes/root";
import createResourceRouter from "./routes/resource";

const logger = createLogger({ file: "index" });

type ResourceInstance = {
  searchService: SearchService;
  inputQueueService: InputQueueService;
  worker: UpdateWorker;
};

function printMemoryUsage() {
  logger.info(`[system] Memory usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
}

async function main() {
  logger.info("Starting Search Server...");
  printMemoryUsage();

  Object.entries(Config).forEach(([key, value]) => {
    let displayValue = value;
    if (typeof value === "string" && (key.endsWith("_PASSWORD") || key.endsWith("_API_KEY"))) {
      displayValue = "*".repeat(value.length);
    }
    logger.info(`[config] ${key}: ${JSON.stringify(displayValue)}`);
  });

  const instances = new Map<string, ResourceInstance>();

  for (const resConfig of Config.resources) {
    const { namePrefix } = resConfig.search;
    logger.info(`Initializing resource: ${namePrefix}`);

    try {
      const searchLogger = createLogger({ file: "search", resource: namePrefix });
      const searchService = new SearchService(resConfig.search, searchLogger);

      const queueLogger = createLogger({ file: "inputQueue", resource: namePrefix });
      const inputQueueService = new InputQueueService(resConfig.inputQueue, queueLogger);

      const workerLogger = createLogger({ file: "worker", resource: namePrefix });
      const worker = new UpdateWorker(searchService, inputQueueService, workerLogger);

      await searchService.open();
      await inputQueueService.open();

      worker.start();

      instances.set(namePrefix, {
        searchService,
        inputQueueService,
        worker,
      });

      logger.info(`Resource [${namePrefix}] is now ready.`);
    } catch (e) {
      logger.error(`Failed to initialize resource [${namePrefix}]: ${e}`);
      throw e;
    }
  }

  const app = express();

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

  const port = Config.TTTS_PORT;
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
          logger.info(`[shutdown] Stopping worker for [${name}]...`);
          await inst.worker.stop();

          logger.info(`[shutdown] Closing SearchService for [${name}]...`);
          await inst.searchService.close();

          logger.info(`[shutdown] Closing InputQueueService for [${name}]...`);
          await inst.inputQueueService.close();
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
