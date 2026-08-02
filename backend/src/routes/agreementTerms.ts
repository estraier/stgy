import { Router, Request, Response } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import { AgreementTermsService } from "../services/agreementTerms";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { hexToDec } from "../utils/format";
import { AuthHelpers } from "./authHelpers";

export default function createAgreementTermsRouter(pgPool: Pool, redis: Redis) {
  const router = Router();
  const agreementTermsService = new AgreementTermsService(pgPool);
  const usersService = new UsersService(pgPool, redis);
  const authService = new AuthService(pgPool, redis);
  const authHelpers = new AuthHelpers(authService, usersService);

  router.get("/latest", async (_req: Request, res: Response) => {
    const term = await agreementTermsService.getLatestAgreementTerm();
    if (!term) return res.status(404).json({ error: "not found" });
    res.json(term);
  });

  router.get("/", async (_req: Request, res: Response) => {
    res.json(await agreementTermsService.listAgreementTermIds());
  });

  router.get("/:id", async (req: Request, res: Response) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const term = await agreementTermsService.getAgreementTerm(req.params.id);
    if (!term) return res.status(404).json({ error: "not found" });
    res.json(term);
  });

  router.post("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    try {
      const term = await agreementTermsService.putAgreementTerm(req.params.id, req.body);
      res.json(term);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const loginUser = await authHelpers.getCurrentUser(req);
    if (!loginUser || !loginUser.isAdmin) {
      return res.status(403).json({ error: "admin only" });
    }
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const deleted = await agreementTermsService.deleteAgreementTerm(req.params.id);
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json({ result: "ok" });
  });

  return router;
}

function isValidId(id: string): boolean {
  try {
    hexToDec(id);
    return true;
  } catch {
    return false;
  }
}
