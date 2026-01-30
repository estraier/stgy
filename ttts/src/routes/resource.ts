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

  router.get("/reservation-mode", (_req: Request, res: Response) => {
    res.json({ enabled: inputQueueService.getReservationMode() });
  });

  router.put("/reservation-mode", (_req: Request, res: Response) => {
    inputQueueService.setReservationMode(true);
    res.json({ enabled: true });
  });

  router.delete("/reservation-mode", (_req: Request, res: Response) => {
    inputQueueService.setReservationMode(false);
    res.json({ enabled: false });
  });

  router.post("/reserve", async (req: Request, res: Response) => {
    try {
      const items = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "array of items is required" });
      }
      await searchService.reserve(items);
      res.json({ result: "reserved", count: items.length });
    } catch (e) {
      logger.error(`Reserve error: ${e}`);
      res.status(500).json({ error: "failed to reserve" });
    }
  });

  router.get("/shards", async (req: Request, res: Response) => {
    try {
      const detailed = req.query.detailed === "true";
      const files = await searchService.listFiles(detailed);
      res.json(files);
    } catch (e) {
      logger.error(`List files error: ${e}`);
      res.status(500).json({ error: "failed to list shards" });
    }
  });

  router.delete("/shards/:timestamp", async (req: Request, res: Response) => {
    try {
      const { timestamp: tsParam } = req.params;
      const timestampStr = Array.isArray(tsParam) ? tsParam[0] : tsParam;
      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: "invalid timestamp" });
      }
      await searchService.removeFile(timestamp);
      res.json({ result: "deleted" });
    } catch (e) {
      logger.error(`Remove shard error: ${e}`);
      res.status(500).json({ error: "failed to remove shard" });
    }
  });

  router.post("/flush", async (_req: Request, res: Response) => {
    try {
      await searchService.flushAll();
      res.json({ result: "flushed" });
    } catch (e) {
      logger.error(`Flush error: ${e}`);
      res.status(500).json({ error: "failed to flush" });
    }
  });

  router.get("/tokenize", (req: Request, res: Response) => {
    try {
      const text = req.query.text as string;
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }
      const locale = (req.query.locale as string) || "en";
      const tokenizer = searchService.getTokenizer();
      const guessedLocale = tokenizer.guessLocale(text, locale);
      const tokens = tokenizer.tokenize(text, guessedLocale);
      res.json(tokens);
    } catch (e) {
      logger.error(`Tokenize error: ${e}`);
      res.status(500).json({ error: "tokenize failed" });
    }
  });

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

  router.put("/:docId", async (req: Request, res: Response) => {
    try {
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

  router.delete("/:docId", async (req: Request, res: Response) => {
    try {
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
