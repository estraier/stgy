import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";

// マジックナンバーの定義
// 今後これらを動的に変えたい場合は、SearchConfig等に統合して参照するようにします
const IDLE_INTERVAL_MS = 10000; // キューが空の時の待機時間
const BUSY_INTERVAL_MS = 500; // 次のタスクがある時の待機時間

export class UpdateWorker {
  private isRunning: boolean = false;
  private isStopping: boolean = false;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;

  constructor(
    private readonly searchService: SearchService,
    private readonly inputQueueService: InputQueueService,
  ) {}

  /**
   * ループを開始する
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isStopping = false;
    this.stopPromise = new Promise((resolve) => {
      this.resolveStop = resolve;
    });

    // メインループを非同期で開始
    this.run();
  }

  /**
   * ループを停止し、実行中の処理が終わるまで待機する
   */
  async stop(): Promise<void> {
    if (!this.isRunning || this.isStopping) return;
    this.isStopping = true;

    // run() 内のループが終了するのを待つ
    if (this.stopPromise) {
      await this.stopPromise;
    }

    this.isRunning = false;
    this.isStopping = false;
  }

  /**
   * メインループ本体
   */
  private async run(): Promise<void> {
    while (!this.isStopping) {
      try {
        const hasProcessed = await this.processOne();

        // 処理直後に停止指示を再確認
        if (this.isStopping) break;

        const interval = hasProcessed ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, interval));
      } catch (error) {
        console.error("UpdateWorker loop error:", error);
        // エラー時は安全のため長めに待機してリトライ
        await new Promise((resolve) => setTimeout(resolve, IDLE_INTERVAL_MS));
      }
    }

    if (this.resolveStop) {
      this.resolveStop();
    }
  }

  /**
   * InputQueueServiceから1件取り出してSearchServiceへ転送する
   * 成功時にのみ元のキューから削除する (At-least-once)
   */
  private async processOne(): Promise<boolean> {
    const tasks = await this.inputQueueService.dequeue(1);
    if (tasks.length === 0) {
      return false;
    }

    const task = tasks[0];

    try {
      if (task.bodyText === null) {
        // 削除タスク
        await this.searchService.removeDocument(task.doc_id, task.timestamp);
      } else {
        // 追加・更新タスク
        await this.searchService.addDocument(
          task.doc_id,
          task.timestamp,
          task.bodyText,
          task.locale || "en",
        );
      }

      // 転送成功後に削除
      await this.inputQueueService.deleteTasks([task.id]);
      return true;
    } catch (error) {
      // ここでエラーを投げるとrun()側でキャッチされ、インターバルを置いてリトライされる
      throw error;
    }
  }
}
