import { Router, Request, Response } from "express";

/**
 * 基本的なシステムエンドポイントを提供するルーター
 */
export default function createRootRouter() {
  const router = Router();

  // ヘルスチェック
  router.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ result: "ok" });
  });

  // 必要に応じてメトリクス関連もここに追加できますが、
  // 現時点では最小構成の /health のみ実装します

  return router;
}
