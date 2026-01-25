import { Router, Request, Response } from "express";
import { SearchService } from "../services/search";
import { InputQueueService } from "../services/inputQueue";
import { createLogger } from "../utils/logger";

const logger = createLogger({ file: "resourceRouter" });

type ResourceInstance = {
  searchService: SearchService;
  inputQueueService: InputQueueService;
};

export default function createResourceRouter(instance: ResourceInstance) {
  const router = Router();
  const { searchService, inputQueueService } = instance;

  /**
   * トークナイズ確認エンドポイント
   */
  router.get("/tokenize", (req: Request, res: Response) => {
    try {
      const text = req.query.text as string;
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }

      const locale = (req.query.locale as string) || "en";
      const tokenizer = searchService.getTokenizer();

      // 文書登録時と同様に、ロケール推定を行ってからトークナイズ
      const guessedLocale = tokenizer.guessLocale(text, locale);
      const tokens = tokenizer.tokenize(text, guessedLocale);

      res.json(tokens);
    } catch (e) {
      logger.error(`Tokenize error: ${e}`);
      res.status(500).json({ error: "tokenize failed" });
    }
  });

  /**
   * 全文検索エンドポイント
   */
  router.get("/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string;
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }

      const locale = (req.query.locale as string) || "en";
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const timeout = parseInt(req.query.timeout as string, 10) || 1000;

      const results = await searchService.search(query, locale, limit, timeout);

      res.json(results);
    } catch (e) {
      logger.error(`Search error: ${e}`);
      res.status(500).json({ error: "search failed" });
    }
  });

  /**
   * 文書の追加・更新エンドポイント
   */
  router.put("/:docId", async (req: Request, res: Response) => {
    try {
      // 明示的に string として扱う
      const docId = req.params.docId as string;
      const { text, timestamp, locale } = req.body;

      if (!text || typeof timestamp !== "number") {
        return res.status(400).json({ error: "text and timestamp are required" });
      }

      await inputQueueService.enqueue(docId, timestamp, text, locale || "en");

      res.status(202).json({ result: "accepted" });
    } catch (e) {
      logger.error(`Enqueue error (put): ${e}`);
      res.status(500).json({ error: "failed to accept update" });
    }
  });

  /**
   * 文書の削除エンドポイント
   */
  router.delete("/:docId", async (req: Request, res: Response) => {
    try {
      // 明示的に string として扱う
      const docId = req.params.docId as string;
      const { timestamp } = req.body;

      if (typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp is required" });
      }

      await inputQueueService.enqueue(docId, timestamp, null, null);

      res.status(202).json({ result: "accepted" });
    } catch (e) {
      logger.error(`Enqueue error (delete): ${e}`);
      res.status(500).json({ error: "failed to accept deletion" });
    }
  });

  return router;
}
