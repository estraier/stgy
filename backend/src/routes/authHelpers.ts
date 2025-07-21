import { Request } from "express";
import { AuthService } from "../services/auth";
import { UsersService } from "../services/users";

export class AuthHelpers {
  private authService: AuthService;
  private usersService: UsersService;

  constructor(authService: AuthService, usersService: UsersService) {
    this.authService = authService;
    this.usersService = usersService;
  }

  async getSessionInfo(req: Request) {
    const sessionId = req.cookies?.session_id;
    if (!sessionId) return null;
    await this.authService.elongateSession(sessionId);
    return await this.authService.getSessionInfo(sessionId);
  }

  async getCurrentUser(req: Request) {
    const sessionInfo = await this.getSessionInfo(req);
    if (!sessionInfo || !sessionInfo.user_id) return null;
    return await this.usersService.getUser(sessionInfo.user_id);
  }
}
