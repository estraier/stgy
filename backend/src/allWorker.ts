import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";
import { UpdateWorker } from "./updateWorker";

import { startMailWorker, lifecycle as mailLifecycle } from "./mailWorker";
import { startMediaWorker, lifecycle as mediaLifecycle } from "./mediaWorker";
import { startAiSummaryWorker, lifecycle as summaryLifecycle } from "./aiSummaryWorker";
import { startAiUserWorker, lifecycle as userLifecycle } from "./aiUserWorker";

const logger = createLogger({ file: "allWorker" });

async function main() {
  logger.info("Starting All-in-One Worker...");

  const searchWorkers: UpdateWorker[] = [];
  const searchPromises = Config.resources.map(async (resConfig) => {
    const { namePrefix } = resConfig.search;
    const searchLogger = createLogger({ file: "search", resource: namePrefix });
    const searchService = new SearchService(resConfig.search, searchLogger);
    const queueLogger = createLogger({ file: "inputQueue", resource: namePrefix });
    const inputQueueService = new InputQueueService(resConfig.inputQueue, queueLogger);
    const workerLogger = createLogger({ file: "worker", resource: namePrefix });
    const worker = new UpdateWorker(searchService, inputQueueService, workerLogger);

    await searchService.open();
    await inputQueueService.open();
    worker.start();
    searchWorkers.push(worker);
    logger.info(`Search worker [${namePrefix}] started.`);
  });

  await Promise.all(searchPromises);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down all workers...`);

    for (const worker of searchWorkers) {
      await worker.stop();
    }

    mailLifecycle.stop();
    mediaLifecycle.stop();
    summaryLifecycle.stop();
    userLifecycle.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await Promise.all([
      startMailWorker(),
      startMediaWorker(),
      startAiSummaryWorker(),
      startAiUserWorker(),
    ]);
  } catch (e) {
    logger.error(`A worker crashed: ${e}`);
  } finally {
    logger.info("All workers stopped. Exiting process.");
    process.exit(0);
  }
}

main().catch((e) => {
  logger.error(`Fatal error in allWorker: ${e}`);
  process.exit(1);
});
