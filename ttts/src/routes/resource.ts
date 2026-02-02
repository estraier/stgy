import { Router, Request, Response } from "express";
import { SearchService } from "../services/search";
import { createLogger } from "../utils/logger";
import { Tokenizer } from "../utils/tokenizer";

const logger = createLogger({ file: "resourceRouter" });

type ResourceInstance = {
  searchService: SearchService;
};

export default function createResourceRouter(instance: ResourceInstance) {
  const router = Router();
  const { searchService } = instance;

  router.get("/maintenance", async (_req: Request, res: Response) => {
    const enabled = await searchService.checkMaintenanceMode();
    res.json({ enabled });
  });

  router.post("/maintenance", async (_req: Request, res: Response) => {
    await searchService.startMaintenanceMode();
    res.json({ enabled: true });
  });

  router.delete("/maintenance", async (_req: Request, res: Response) => {
    await searchService.endMaintenanceMode();
    res.json({ enabled: false });
  });

  router.post("/reconstruct", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }

    try {
      const { timestamp, newInitialId, useExternalId } = req.body;
      if (typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp is required" });
      }

      logger.info(`[Reconstruct] Starting for timestamp=${timestamp}...`);
      await searchService.reconstructIndexFile(timestamp, newInitialId, !!useExternalId);

      res.json({ result: "reconstructed", timestamp });
    } catch (e) {
      logger.error(`[Reconstruct] Error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.post("/reserve", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }

    try {
      const items = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "array of items is required" });
      }
      await searchService.reserveIds(items);
      res.json({ result: "reserved", count: items.length });
    } catch (e) {
      logger.error(`Reserve error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.delete("/shards/:timestamp", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }

    try {
      const { timestamp: tsParam } = req.params;
      const timestamp = parseInt(tsParam, 10);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: "invalid timestamp" });
      }
      await searchService.removeIndexFile(timestamp);
      res.json({ result: "deleted" });
    } catch (e) {
      logger.error(`Remove shard error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.delete("/shards", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }
    try {
      await searchService.removeAllIndexFiles();
      res.json({ result: "all deleted" });
    } catch (e) {
      logger.error(`Remove all shards error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.get("/shards", async (req: Request, res: Response) => {
    try {
      const detailed = req.query.detailed === "true";
      const files = await searchService.listIndexFiles(detailed);
      res.json(files);
    } catch (e) {
      logger.error(`List files error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.post("/flush", async (_req: Request, res: Response) => {
    try {
      await searchService.synchronize();
      res.json({ result: "flushed" });
    } catch (e) {
      logger.error(`Flush error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.get("/tokenize", async (req: Request, res: Response) => {
    try {
      const text = req.query.text as string;
      if (!text) {
        return res.status(400).json({ error: "text is required" });
      }
      const locale = (req.query.locale as string) || "en";

      const tokenizer = await Tokenizer.getInstance();
      const guessedLocale = tokenizer.guessLocale(text, locale);
      const tokens = tokenizer.tokenize(text, guessedLocale);
      res.json(tokens);
    } catch (e) {
      logger.error(`Tokenize error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
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
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
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
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.get("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const omitBodyText = req.query.omitBodyText === "true";
      const omitAttrs = req.query.omitAttrs === "true";

      const docs = await searchService.fetchDocuments([docId], omitBodyText, omitAttrs);
      if (docs.length === 0) {
        return res.status(404).json({ error: "document not found" });
      }
      res.json(docs[0]);
    } catch (e) {
      logger.error(`Fetch document error: ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.put("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const { text, timestamp, locale, attrs } = req.body;
      if (!text || typeof timestamp !== "number") {
        return res.status(400).json({ error: "text and timestamp are required" });
      }

      await searchService.enqueueTask(docId, timestamp, text, locale || "en", attrs || null);

      res.status(202).json({ result: "accepted" });
    } catch (e) {
      logger.error(`Enqueue error (put): ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  router.delete("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const { timestamp } = req.body;
      if (typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp is required" });
      }

      await searchService.enqueueTask(docId, timestamp, null, null, null);

      res.status(202).json({ result: "accepted" });
    } catch (e) {
      logger.error(`Enqueue error (delete): ${e}`);
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
