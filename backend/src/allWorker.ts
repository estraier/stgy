import { createLogger } from "./utils/logger";
import { startMailWorker, lifecycle as mailLifecycle } from "./mailWorker";
import { startMediaWorker, lifecycle as mediaLifecycle } from "./mediaWorker";
import { startAiSummaryWorker, lifecycle as summaryLifecycle } from "./aiSummaryWorker";
import { startAiUserWorker, lifecycle as userLifecycle } from "./aiUserWorker";
import { startNotificationWorker, lifecycle as notificationLifecycle } from "./notificationWorker";

const logger = createLogger({ file: "allWorker" });

async function main() {
  logger.info("Starting All-in-One Worker (Backend)...");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down all workers...`);

    mailLifecycle.stop();
    mediaLifecycle.stop();
    summaryLifecycle.stop();
    userLifecycle.stop();
    notificationLifecycle.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await Promise.all([
      startMailWorker(),
      startMediaWorker(),
      startAiSummaryWorker(),
      startAiUserWorker(),
      startNotificationWorker(),
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
