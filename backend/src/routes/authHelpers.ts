import { Request } from "express";
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
}
