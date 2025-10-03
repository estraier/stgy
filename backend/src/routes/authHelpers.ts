import { Request, Response } from "express";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";
import { SessionInfo } from "../models/session";
import { UserLite } from "../models/user";

export class AuthHelpers {
  private authService: AuthService;
  private usersService: UsersService;

  constructor(authService: AuthService, usersService: UsersService) {
    this.authService = authService;
    this.usersService = usersService;
  }

  getSessionId(req: Request): string | null {
    return req.cookies?.session_id ?? null;
  }

  async getSessionInfo(req: Request): Promise<SessionInfo | null> {
    const sessionId = req.cookies?.session_id;
    if (!sessionId) return null;
    return await this.authService.getSessionInfo(sessionId);
  }

  async getCurrentUser(req: Request): Promise<UserLite | null> {
    const sessionInfo = await this.getSessionInfo(req);
    if (!sessionInfo || !sessionInfo.userId) return null;
    return await this.usersService.getUserLite(sessionInfo.userId);
  }

  async requireLogin(req: Request, res: Response): Promise<UserLite | null> {
    const loginUser = await this.getCurrentUser(req);
    if (!loginUser) {
      res.status(401).json({ error: "login required" });
      return null;
    }
    return loginUser as UserLite;
  }

  async checkBlock(blockerId: string, blockeeId: string): Promise<boolean> {
    if (blockerId === blockeeId) {
      return false;
    }
    if (await this.usersService.checkBlock({ blockerId, blockeeId })) {
      return true;
    }
    const user = await this.usersService.getUserLite(blockerId);
    if (user && user.blockStrangers) {
      if (
        !(await this.usersService.checkFollow({ followerId: blockerId, followeeId: blockeeId }))
      ) {
        return true;
      }
    }
    return false;
  }

  static getPageParams<T extends readonly [string, ...string[]]>(
    req: Request,
    maxLimit: number,
    orderOptions: T,
  ): { offset: number; limit: number; order: T[number] } {
    const offset = parseInt((req.query.offset as string) ?? "0", 10);
    let limit = Math.min(parseInt((req.query.limit as string) ?? "100", 10), maxLimit);
    let order = req.query.order as T[number];
    if (!orderOptions.includes(order as string)) {
      order = orderOptions[0];
    }
    return { offset, limit, order };
  }
}
