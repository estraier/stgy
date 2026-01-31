import { createLogger } from "./utils/logger";
import { connectPgWithRetry } from "./utils/servers";
import { WorkerLifecycle, runIfMain } from "./utils/workerRunner";
import { SearchService, SearchIndexTask } from "./services/search";

const logger = createLogger({ file: "searchIndexWorker" });
export const lifecycle = new WorkerLifecycle();

async function processSearchTasks(searchService: SearchService) {
  while (lifecycle.isActive) {
    try {
      const tasks = await searchService.fetchTasks(100);

      if (tasks.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const processedIds: string[] = [];
      for (const task of tasks) {
        if (!lifecycle.isActive) break;

        try {
          await handleTask(searchService, task);
          processedIds.push(task.id);
        } catch (e) {
          logger.error(`Failed to process search task ${task.id}: ${e}`);
        }
      }

      if (processedIds.length > 0) {
        await searchService.deleteTasks(processedIds);
        logger.info(`Processed ${processedIds.length} search index tasks.`);
      }
    } catch (e) {
      if (!lifecycle.isActive) break;
      logger.error(`Error in search index worker loop: ${e}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function handleTask(service: SearchService, task: SearchIndexTask) {
  const ts = parseInt(task.timestamp, 10);
  const seconds = isNaN(ts) ? 0 : ts;

  if (task.bodyText === null) {
    await service.removeDocument(task.resourceId, seconds);
  } else {
    await service.addDocument({
      id: task.resourceId,
      bodyText: task.bodyText,
      locale: task.locale || "en",
      timestamp: seconds,
    });
  }
}

export async function startSearchIndexWorker() {
  logger.info("STGY search index worker started");
  const pgPool = await connectPgWithRetry();

  const resources = ["posts", "users"];
  const runners = resources.map(async (resourceName) => {
    const service = new SearchService(pgPool, resourceName);
    await processSearchTasks(service);
  });

  try {
    await Promise.all(runners);
  } finally {
    logger.info("Stopping search index worker, disconnecting pg...");
    try {
      await pgPool.end();
    } catch (e) {
      logger.error(`PG disconnect error: ${e}`);
    }
  }
}

runIfMain(module, startSearchIndexWorker, logger, lifecycle);
