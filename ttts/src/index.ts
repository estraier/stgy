import { Config } from "./config";
import { logger, createLogger } from "./utils/logger";
import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";
import { UpdateWorker } from "./updateWorker";
import express, { ErrorRequestHandler } from "express";
import createRootRouter from "./routes/root";
import createResourceRouter from "./routes/resource";

const fileLogger = createLogger({ file: "index" });

/**
 * リソースごとの主要コンポーネントを保持する型
 */
type ResourceInstance = {
  searchService: SearchService;
  inputQueueService: InputQueueService;
  worker: UpdateWorker;
};

async function main() {
  fileLogger.info("Starting Search Server...");

  // 1. 設定内容のロギング (パスワード等の秘匿情報をマスク)
  Object.entries(Config).forEach(([key, value]) => {
    let displayValue = value;
    if (typeof value === "string" && (key.endsWith("_PASSWORD") || key.endsWith("_API_KEY"))) {
      displayValue = "*".repeat(value.length);
    }
    fileLogger.info(`[config] ${key}: ${JSON.stringify(displayValue)}`);
  });

  // 2. リソース (posts, users等) の初期化
  const instances = new Map<string, ResourceInstance>();

  for (const resConfig of Config.resources) {
    const { namePrefix } = resConfig.search;
    fileLogger.info(`Initializing resource: ${namePrefix}`);

    try {
      const searchService = new SearchService(resConfig.search);
      const inputQueueService = new InputQueueService(resConfig.inputQueue);
      const worker = new UpdateWorker(searchService, inputQueueService);

      // サービスの起動
      // SearchService.open() は内部でリカバリ(未完了バッチの反映)も行います
      await searchService.open();
      await inputQueueService.open();

      // 非同期でポーリングループを開始
      worker.start();

      instances.set(namePrefix, {
        searchService,
        inputQueueService,
        worker,
      });

      fileLogger.info(`Resource [${namePrefix}] is now ready.`);
    } catch (e) {
      fileLogger.error(`Failed to initialize resource [${namePrefix}]: ${e}`);
      throw e; // 起動に失敗した場合は致命的エラーとして停止させる
    }
  }

  // 3. Expressサーバーの構築
  const app = express();

  // DoS対策としてのボディサイズ制限
  app.use(express.json({ limit: 1048576 })); // 1MB

  // 基本ルート (健康診断エンドポイント等)
  app.use("/", createRootRouter());

  // 各リソース別の検索・更新エンドポイント
  // 各ネームプレフィックスに対して個別のルーターを生成して紐付け
  for (const [name, inst] of instances.entries()) {
    app.use(`/${name}`, createResourceRouter(inst));
    fileLogger.info(`Routing established for: /${name}`);
  }

  // エラーハンドラー
  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    fileLogger.error(`[API ERROR] ${err}`);
    if (res.headersSent) return next(err);
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: (err as { message?: string }).message || "internal server error",
    });
  };
  app.use(errorHandler);

  // サーバーの待受開始
  const port = (Config as any).BACKEND_PORT || 3000;
  const server = app.listen(port, "0.0.0.0", () => {
    fileLogger.info(`Search Server running on http://0.0.0.0:${port}`);
  });

  // 4. グレースフルシャットダウン制御
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    fileLogger.info(`[shutdown] Received ${signal}. Closing all resources...`);

    // 新規接続を受け付けないようにHTTPサーバーを閉じる
    server.close(async (err) => {
      if (err) {
        fileLogger.error(`[shutdown] HTTP server close error: ${err}`);
      }

      // 逆順でサービスを停止 (Worker -> SearchService -> InputQueueService)
      for (const [name, inst] of instances.entries()) {
        try {
          fileLogger.info(`[shutdown] Stopping worker for [${name}]...`);
          await inst.worker.stop();

          fileLogger.info(`[shutdown] Closing SearchService for [${name}]...`);
          await inst.searchService.close();

          fileLogger.info(`[shutdown] Closing InputQueueService for [${name}]...`);
          await inst.inputQueueService.close();
        } catch (e) {
          fileLogger.error(`[shutdown] Error during closing [${name}]: ${e}`);
        }
      }

      fileLogger.info("[shutdown] Cleanup complete. Goodbye.");
      process.exit(0);
    });

    // 10秒待っても終わらない場合は強制終了
    setTimeout(() => {
      fileLogger.warn("[shutdown] Shutdown timed out, force exiting.");
      process.exit(1);
    }, 10000).unref();
  }

  // OSシグナルの監視
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// メインルーチンの実行
main().catch((e) => {
  fileLogger.error(`Fatal error during startup: ${e}`);
  process.exit(1);
});
