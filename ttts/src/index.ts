import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { SearchService } from "./services/search";
import { InputQueueService } from "./services/inputQueue";
import { UpdateWorker } from "./updateWorker";
import express, { ErrorRequestHandler } from "express";
import createRootRouter from "./routes/root";
import createResourceRouter from "./routes/resource";

const logger = createLogger({ file: "index" });

/**
 * リソースごとの主要コンポーネントを保持する型
 */
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

  // 1. 設定内容のロギング (パスワード等の秘匿情報をマスク)
  Object.entries(Config).forEach(([key, value]) => {
    let displayValue = value;
    if (typeof value === "string" && (key.endsWith("_PASSWORD") || key.endsWith("_API_KEY"))) {
      displayValue = "*".repeat(value.length);
    }
    logger.info(`[config] ${key}: ${JSON.stringify(displayValue)}`);
  });

  // 2. リソース (posts, users等) の初期化
  const instances = new Map<string, ResourceInstance>();

  for (const resConfig of Config.resources) {
    const { namePrefix } = resConfig.search;
    logger.info(`Initializing resource: ${namePrefix}`);

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

      logger.info(`Resource [${namePrefix}] is now ready.`);
    } catch (e) {
      logger.error(`Failed to initialize resource [${namePrefix}]: ${e}`);
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
    logger.info(`Routing established for: /${name}`);
  }

  // エラーハンドラー
  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    logger.error(`[API ERROR] ${err}`);
    if (res.headersSent) return next(err);
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: (err as { message?: string }).message || "internal server error",
    });
  };
  app.use(errorHandler);

  // サーバーの待受開始
  const port = Config.TTTS_PORT;
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info(`Search Server running on http://0.0.0.0:${port}`);
    printMemoryUsage();
  });

  // 4. グレースフルシャットダウン制御
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[shutdown] Received ${signal}. Closing all resources...`);

    // 新規接続を受け付けないようにHTTPサーバーを閉じる
    server.close(async (err) => {
      if (err) {
        logger.error(`[shutdown] HTTP server close error: ${err}`);
      }

      // 逆順でサービスを停止 (Worker -> SearchService -> InputQueueService)
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

    // 10秒待っても終わらない場合は強制終了
    setTimeout(() => {
      logger.warn("[shutdown] Shutdown timed out, force exiting.");
      process.exit(1);
    }, 10000).unref();
  }

  // OSシグナルの監視
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// メインルーチンの実行
main().catch((e) => {
  logger.error(`Fatal error during startup: ${e}`);
  process.exit(1);
});
