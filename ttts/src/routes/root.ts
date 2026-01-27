import { Router, Request, Response } from "express";

export default function createRootRouter() {
  const router = Router();

  router.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ result: "ok" });
  });

  return router;
}
