import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { Principal } from "./rbac";
import { Sessions } from "./sessions";

export const SESSION_COOKIE = "ap_session";

/** The session token from `Authorization: Bearer …` (Mini App) or the session cookie (website). */
export function sessionToken(req: Pick<Request, "headers">): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim() || undefined;
  const cookie = req.headers.cookie;
  if (typeof cookie !== "string") return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("=")) || undefined;
  }
  return undefined;
}

/**
 * The only place `request.principal` is set: from a valid session, never from
 * anything else the client sends. The guard then decides what it may do.
 */
@Injectable()
export class PrincipalMiddleware implements NestMiddleware {
  constructor(private readonly sessions: Sessions) {}

  async use(req: Request & { principal?: Principal }, _res: Response, next: NextFunction): Promise<void> {
    try {
      const principal = await this.sessions.resolve(sessionToken(req));
      if (principal) req.principal = principal;
      next();
    } catch (e) {
      next(e);
    }
  }
}
