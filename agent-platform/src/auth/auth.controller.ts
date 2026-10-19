import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  GoneException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Env } from "../config/env";
import { ENV } from "../tokens";
import { Auth, AuthError, WEB_START_PREFIX, type LoginResult } from "./auth.service";
import { Authenticated, Public } from "./guard";
import { SESSION_COOKIE, sessionToken } from "./principal.middleware";
import { RateLimiter } from "./rateLimit";
import type { Principal } from "./rbac";
import { verifyInitData, verifyLoginWidget, type TelegramIdentity } from "./telegramSignature";

type Req_ = Request & { principal?: Principal };

/** Login attempts: 10 per minute per IP (plan 04 §7). */
export const LOGIN_LIMIT = { limit: 10, windowMs: 60_000 };
/** The website polls sign-up status every few seconds: 60 per minute per IP. */
export const STATUS_LIMIT = { limit: 60, windowMs: 60_000 };

/** Auth errors to HTTP statuses; anything else is rethrown unchanged (→ 500). */
export function toHttp(e: unknown): never {
  if (!(e instanceof AuthError)) throw e;
  switch (e.code) {
    case "NO_ACCOUNT":
      throw new ForbiddenException(e.message);
    case "UNKNOWN_CODE":
      throw new NotFoundException(e.message);
    case "CODE_USED":
      throw new GoneException(e.message);
    default:
      throw new BadRequestException(e.message);
  }
}

@Controller()
export class AuthController {
  private readonly loginLimiter = new RateLimiter(LOGIN_LIMIT.limit, LOGIN_LIMIT.windowMs);
  private readonly statusLimiter = new RateLimiter(STATUS_LIMIT.limit, STATUS_LIMIT.windowMs);

  constructor(
    private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private botToken(): string {
    if (!this.env.TELEGRAM_BOT_TOKEN || !this.env.TELEGRAM_BOT_USERNAME) {
      throw new ServiceUnavailableException("Telegram login is not configured yet");
    }
    return this.env.TELEGRAM_BOT_TOKEN;
  }

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers["user-agent"] };
  }

  /** Session in the body (Mini App: Bearer) and as an httpOnly cookie (website). */
  private session(res: Response, result: LoginResult) {
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });
    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      principal: describe(result.principal),
    };
  }

  private async login(req: Request, res: Response, identity: TelegramIdentity | null, as: unknown) {
    if (!identity) throw new ForbiddenException("Telegram signature is invalid or expired");
    try {
      return this.session(res, await this.auth.login(identity, as, this.meta(req)));
    } catch (e) {
      toHttp(e);
    }
  }

  @Public()
  @Post("auth/telegram/miniapp")
  @HttpCode(200)
  miniapp(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    this.loginLimiter.hit(`login:${req.ip}`);
    const token = this.botToken();
    return this.login(req, res, verifyInitData(String(body.initData ?? ""), token), body.as);
  }

  @Public()
  @Post("auth/telegram/widget")
  @HttpCode(200)
  widget(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    this.loginLimiter.hit(`login:${req.ip}`);
    const token = this.botToken();
    return this.login(req, res, verifyLoginWidget(body, token), body.as);
  }

  @Public()
  @Post("auth/signup/start")
  @HttpCode(200)
  async signupStart(@Req() req: Request, @Body() body: Record<string, unknown>) {
    this.loginLimiter.hit(`signup:${req.ip}`);
    this.botToken();
    try {
      const { code, expiresAt } = await this.auth.startWebSignup(body.ref);
      return {
        code,
        expiresAt: expiresAt.toISOString(),
        botLink: `https://t.me/${this.env.TELEGRAM_BOT_USERNAME}?start=${WEB_START_PREFIX}${code}`,
      };
    } catch (e) {
      toHttp(e);
    }
  }

  @Public()
  @Get("auth/signup/status")
  async signupStatus(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("code") code: unknown,
  ) {
    this.statusLimiter.hit(`status:${req.ip}`);
    try {
      const result = await this.auth.webSignupStatus(code, this.meta(req));
      return result.status === "pending" ? result : { status: "done", ...this.session(res, result) };
    } catch (e) {
      toHttp(e);
    }
  }

  @Authenticated()
  @Get("me")
  me(@Req() req: Req_) {
    return describe(req.principal as Principal);
  }

  @Authenticated()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Req_, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(sessionToken(req) as string, req.principal as Principal, this.meta(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }
}

/** JSON-safe view of a principal (bigint ids as strings). */
export function describe(p: Principal) {
  if (p.kind === "staff") return { kind: p.kind, staffId: p.staffId.toString(), roles: p.roles };
  if (p.kind === "agent_member")
    return { kind: p.kind, memberId: p.memberId.toString(), agentId: p.agentId.toString() };
  return { kind: p.kind, playerId: p.playerId.toString() };
}
