import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";

const IDLE_INTERVAL_MS = 10000;
const BUSY_INTERVAL_MS = 500;

export class UpdateWorker {
  private isRunning: boolean = false;
  private isStopping: boolean = false;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(
    private readonly searchService: SearchService,
    private readonly inputQueueService: InputQueueService,
  ) {}

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
        const hasProcessed = await this.processOne();

        if (this.isStopping) break;

        const interval = hasProcessed ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, interval));
      } catch (error) {
        console.error("UpdateWorker loop error:", error);
        await new Promise((resolve) => setTimeout(resolve, IDLE_INTERVAL_MS));
      }
    }

    if (this.resolveStop) {
      this.resolveStop();
    }
  }

  private async processOne(): Promise<boolean> {
    const tasks = await this.inputQueueService.dequeue(1);
    if (tasks.length === 0) {
      return false;
    }

    const task = tasks[0];

    if (task.bodyText === null) {
      await this.searchService.removeDocument(task.doc_id, task.timestamp);
    } else {
      await this.searchService.addDocument(
        task.doc_id,
        task.timestamp,
        task.bodyText,
        task.locale || "en",
      );
    }

    await this.inputQueueService.deleteTasks([task.id]);
    return true;
  }
}
