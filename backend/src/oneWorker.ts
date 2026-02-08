import { createLogger } from "./utils/logger";
import { startMailWorker, lifecycle as mailLifecycle } from "./mailWorker";
import { startMediaWorker, lifecycle as mediaLifecycle } from "./mediaWorker";
import { startNotificationWorker, lifecycle as notificationLifecycle } from "./notificationWorker";
import { startSearchIndexWorker, lifecycle as searchIndexLifecycle } from "./searchIndexWorker";
import { startAiSummaryWorker, lifecycle as aiSummaryLifecycle } from "./aiSummaryWorker";
import { startAiUserWorker, lifecycle as aiUserLifecycle } from "./aiUserWorker";

const logger = createLogger({ file: "oneWorker" });

async function main() {
  logger.info("Starting All-in-One Worker (Backend)...");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down all workers...`);
    mailLifecycle.stop();
    mediaLifecycle.stop();
    notificationLifecycle.stop();
    searchIndexLifecycle.stop();
    aiSummaryLifecycle.stop();
    aiUserLifecycle.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await Promise.all([
      startMailWorker(),
      startMediaWorker(),
      startNotificationWorker(),
      startSearchIndexWorker(),
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
  logger.error(`Fatal error in oneWorker: ${e}`);
  process.exit(1);
});
