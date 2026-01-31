import { Router, Request, Response } from "express";
import { SearchService } from "../services/search";
import { InputQueueService } from "../services/inputQueue";
import { createLogger } from "../utils/logger";

const logger = createLogger({ file: "resourceRouter" });

type ResourceInstance = {
  searchService: SearchService;
  inputQueueService: InputQueueService;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function createResourceRouter(instance: ResourceInstance) {
  const router = Router();
  const { searchService, inputQueueService } = instance;

  router.get("/reservation-mode", (_req: Request, res: Response) => {
    // 修正: getReservationMode -> isReservationMode
    res.json({ enabled: inputQueueService.isReservationMode() });
  });

  router.put("/reservation-mode", (_req: Request, res: Response) => {
    if (inputQueueService.tryEnterReservationMode()) {
      res.json({ enabled: true });
    } else {
      res.status(409).json({ error: "Reservation mode is already enabled" });
    }
  });

  router.delete("/reservation-mode", (_req: Request, res: Response) => {
    inputQueueService.exitReservationMode();
    res.json({ enabled: false });
  });

  router.get("/reconstruction-mode", (_req: Request, res: Response) => {
    res.json({ enabled: inputQueueService.isReconstructionMode() });
  });

  router.post("/reconstruct", async (req: Request, res: Response) => {
    if (!inputQueueService.tryEnterReconstructionMode()) {
      return res.status(409).json({
        error: "Reconstruction is already in progress.",
      });
    }

    try {
      const { timestamp, newInitialId, useExternalId } = req.body;

      if (typeof timestamp !== "number" || typeof newInitialId !== "number") {
        return res.status(400).json({ error: "timestamp and newInitialId are required numbers" });
      }

      logger.info(`[Reconstruct Flow] Initiating safe reconstruction for shard ts=${timestamp}...`);

      logger.info("[Reconstruct Flow] Waiting for workers to settle...");
      await sleep(1000);

      logger.info("[Reconstruct Flow] Flushing all shards...");
      await searchService.flushAll();

      logger.info("[Reconstruct Flow] Starting reconstruction...");
      await searchService.reconstructShard(timestamp, newInitialId, !!useExternalId);

      logger.info("[Reconstruct Flow] Reconstruction successful.");
      res.json({ result: "reconstructed", timestamp });
    } catch (e) {
      logger.error(`[Reconstruct Flow] Error: ${e}`);
      res.status(500).json({ error: "failed to reconstruct shard", details: String(e) });
    } finally {
      inputQueueService.exitReconstructionMode();
      logger.info("[Reconstruct Flow] Reconstruction mode disabled. Workers resumed.");
    }
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
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const timeout = parseInt(req.query.timeout as string, 10) || 1;
      const results = await searchService.search(query, locale, limit, offset, timeout);
      res.json(results);
    } catch (e) {
      logger.error(`Search error: ${e}`);
      res.status(500).json({ error: "search failed" });
    }
  });

  router.get("/search-fetch", async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string;
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }
      const locale = (req.query.locale as string) || "en";
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const timeout = parseInt(req.query.timeout as string, 10) || 1;
      const omitBodyText = req.query.omitBodyText === "true";
      const omitAttrs = req.query.omitAttrs === "true";

      const ids = await searchService.search(query, locale, limit, offset, timeout);

      if (ids.length === 0) {
        return res.json([]);
      }

      const docs = await searchService.fetchDocuments(ids, omitBodyText, omitAttrs);

      const docMap = new Map(docs.map((d) => [d.id, d]));
      const orderedDocs = ids.map((id) => docMap.get(id)).filter((d) => d !== undefined);

      res.json(orderedDocs);
    } catch (e) {
      logger.error(`Search-fetch error: ${e}`);
      res.status(500).json({ error: "search-fetch failed" });
    }
  });

  router.get("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId as string;
      const omitBodyText = req.query.omitBodyText === "true";
      const omitAttrs = req.query.omitAttrs === "true";

      const docs = await searchService.fetchDocuments([docId], omitBodyText, omitAttrs);

      if (docs.length === 0) {
        return res.status(404).json({ error: "document not found" });
      }
      res.json(docs[0]);
    } catch (e) {
      logger.error(`Fetch document error: ${e}`);
      res.status(500).json({ error: "failed to fetch document" });
    }
  });

  router.put("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId as string;
      const { text, timestamp, locale, attrs } = req.body;
      if (!text || typeof timestamp !== "number") {
        return res.status(400).json({ error: "text and timestamp are required" });
      }
      await inputQueueService.enqueue(docId, timestamp, text, locale || "en", attrs || null);
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
      await inputQueueService.enqueue(docId, timestamp, null, null, null);
      res.status(202).json({ result: "accepted" });
    } catch (e) {
      logger.error(`Enqueue error (delete): ${e}`);
      res.status(500).json({ error: "failed to accept deletion" });
    }
  });

  return router;
}
