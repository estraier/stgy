import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";
import { Logger } from "pino";

const IDLE_INTERVAL_MS = 10000;
const BUSY_INTERVAL_MS = 100;
const BATCH_SIZE = 100;

export class UpdateWorker {
  private isRunning: boolean = false;
  private isStopping: boolean = false;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private logger: Logger;

  constructor(
    private readonly searchService: SearchService,
    private readonly inputQueueService: InputQueueService,
    logger: Logger,
  ) {
    this.logger = logger;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isStopping = false;
    this.stopPromise = new Promise((resolve) => {
      this.resolveStop = resolve;
    });

    this.run();
  }

  async stop(): Promise<void> {
    if (!this.isRunning || this.isStopping) return;
    this.isStopping = true;

    if (this.stopPromise) {
      await this.stopPromise;
    }

    this.isRunning = false;
    this.isStopping = false;
  }

  private async run(): Promise<void> {
    while (!this.isStopping) {
      try {
        const hasProcessed = await this.processBatch();
        if (this.isStopping) break;
        const interval = hasProcessed ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, interval));
      } catch (error) {
        this.logger.error(`UpdateWorker loop error: ${error}`);
        await new Promise((resolve) => setTimeout(resolve, IDLE_INTERVAL_MS));
      }
    }
    if (this.resolveStop) {
      this.resolveStop();
    }
  }

  private async processBatch(): Promise<boolean> {
    const tasks = await this.inputQueueService.dequeue(BATCH_SIZE);
    if (tasks.length === 0) {
      return false;
    }

    const processedIds: number[] = [];

    for (const task of tasks) {
      try {
        if (task.bodyText === null) {
          await this.searchService.removeDocument(task.doc_id, task.timestamp);
        } else {
          await this.searchService.addDocument(
            task.doc_id,
            task.timestamp,
            task.bodyText,
            task.locale || "en",
            task.attrs,
          );
        }
        processedIds.push(task.id);
      } catch (e) {
        this.logger.error(`Failed to process task ${task.id} (doc: ${task.doc_id}): ${e}`);
        processedIds.push(task.id);
      }
    }

    if (processedIds.length > 0) {
      await this.inputQueueService.deleteTasks(processedIds);
    }

    return true;
  }
}
