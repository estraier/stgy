import { Router, Request, Response } from "express";
import { SearchService } from "../services/search";
import { Tokenizer } from "../utils/tokenizer";

type ResourceInstance = {
  searchService: SearchService;
};

export default function createResourceRouter(instance: ResourceInstance) {
  const router = Router();
  const { searchService } = instance;

  const handleWait = async (req: Request, taskId: number) => {
    if (req.query.wait === "true" || req.body.wait === true) {
      await searchService.waitTask(taskId);
    }
  };

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
      const taskId = await searchService.enqueueTask({
        type: "RECONSTRUCT",
        payload: { targetTimestamp: timestamp, newInitialId, useExternalId: !!useExternalId },
      });
      await handleWait(req, taskId);
      res.json({ result: "enqueued", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post("/reserve", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }
    try {
      const { timestamp, ids } = req.body;
      if (!Array.isArray(ids) || typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp and array of ids are required" });
      }
      const taskId = await searchService.enqueueTask({
        type: "RESERVE",
        payload: { targetTimestamp: timestamp, ids },
      });
      await handleWait(req, taskId);
      res.json({ result: "enqueued", taskId, count: ids.length });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.delete("/shards/:timestamp", async (req: Request, res: Response) => {
    if (!(await searchService.checkMaintenanceMode())) {
      return res.status(409).json({ error: "Maintenance mode required" });
    }
    try {
      const timestamp = parseInt(req.params.timestamp, 10);
      if (isNaN(timestamp)) return res.status(400).json({ error: "invalid timestamp" });
      const taskId = await searchService.enqueueTask({
        type: "DROP_SHARD",
        payload: { targetTimestamp: timestamp },
      });
      await handleWait(req, taskId);
      res.json({ result: "enqueued", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/shards", async (req: Request, res: Response) => {
    try {
      const detailed = req.query.detailed === "true";
      const files = await searchService.listIndexFiles(detailed);
      res.json(files);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post("/flush", async (req: Request, res: Response) => {
    try {
      const taskId = await searchService.enqueueTask({ type: "SYNC", payload: {} });
      await handleWait(req, taskId);
      res.json({ result: "flushed", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post("/optimize", async (req: Request, res: Response) => {
    try {
      const { timestamp } = req.body;
      if (typeof timestamp !== "number")
        return res.status(400).json({ error: "timestamp is required" });
      const taskId = await searchService.enqueueTask({
        type: "OPTIMIZE",
        payload: { targetTimestamp: timestamp },
      });
      await handleWait(req, taskId);
      res.json({ result: "enqueued", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/tokenize", async (req: Request, res: Response) => {
    try {
      const text = req.query.text as string;
      if (!text) return res.status(400).json({ error: "text is required" });
      const locale = (req.query.locale as string) || "en";
      const tokenizer = await Tokenizer.getInstance();
      const guessedLocale = tokenizer.guessLocale(text, locale);
      const tokens = tokenizer.tokenize(text, guessedLocale);
      res.json(tokens);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string;
      if (!query) return res.status(400).json({ error: "query is required" });
      const locale = (req.query.locale as string) || "en";
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const timeout = parseInt(req.query.timeout as string, 10) || 1;
      const results = await searchService.search(query, locale, limit, offset, timeout);
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/search-fetch", async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string;
      if (!query) return res.status(400).json({ error: "query is required" });
      const locale = (req.query.locale as string) || "en";
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const timeout = parseInt(req.query.timeout as string, 10) || 1;
      const omitBodyText = req.query.omitBodyText === "true";
      const omitAttrs = req.query.omitAttrs === "true";

      const ids = await searchService.search(query, locale, limit, offset, timeout);
      if (ids.length === 0) return res.json([]);

      const docs = await searchService.fetchDocuments(ids, omitBodyText, omitAttrs);
      const docMap = new Map(docs.map((d) => [d.id, d]));
      const orderedDocs = ids.map((id) => docMap.get(id)).filter((d) => d !== undefined);
      res.json(orderedDocs);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const omitBodyText = req.query.omitBodyText === "true";
      const omitAttrs = req.query.omitAttrs === "true";
      const docs = await searchService.fetchDocuments([docId], omitBodyText, omitAttrs);
      if (docs.length === 0) return res.status(404).json({ error: "document not found" });
      res.json(docs[0]);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.put("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const { text, timestamp, locale, attrs } = req.body;
      if (!text || typeof timestamp !== "number") {
        return res.status(400).json({ error: "text and timestamp are required" });
      }
      const taskId = await searchService.enqueueTask({
        type: "ADD",
        payload: { docId, timestamp, bodyText: text, locale: locale || "en", attrs: attrs || null },
      });
      await handleWait(req, taskId);
      res.status(202).json({ result: "accepted", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.delete("/:docId", async (req: Request, res: Response) => {
    try {
      const docId = req.params.docId;
      const { timestamp } = req.body;
      if (typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp is required" });
      }
      const taskId = await searchService.enqueueTask({
        type: "REMOVE",
        payload: { docId, timestamp },
      });
      await handleWait(req, taskId);
      res.status(202).json({ result: "accepted", taskId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
