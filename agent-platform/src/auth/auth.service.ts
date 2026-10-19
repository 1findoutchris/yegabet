import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { audit } from "./audit";
import type { Principal } from "./rbac";
import { Sessions, sha256, type PrincipalKind } from "./sessions";
import type { TelegramIdentity } from "./telegramSignature";

export type AuthErrorCode = "NO_ACCOUNT" | "INVALID_REFERRAL" | "UNKNOWN_CODE" | "CODE_USED" | "BAD_REQUEST";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const LOGIN_AS: readonly PrincipalKind[] = ["player", "agent_member", "staff"];
/** Website hand-off codes live 15 minutes (plan 04). */
export const WEB_CODE_TTL_MS = 15 * 60 * 1000;
/** Prefix that marks a website hand-off in the bot's /start payload. */
export const WEB_START_PREFIX = "w_";

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  principal: Principal;
}

/**
 * Login and the website sign-up hand-off. Framework-free; the controller only
 * verifies the Telegram signature first and maps errors to HTTP.
 */
export class Auth {
  constructor(
    private readonly db: PrismaClient,
    private readonly sessions: Sessions,
  ) {}

  /**
   * A Telegram user signs in as one of their roles. The same Telegram account
   * may be a player and staff at once: `as` chooses which, and only an active
   * record of that kind counts.
   */
  async login(identity: TelegramIdentity, as: unknown, meta: RequestMeta): Promise<LoginResult> {
    if (!LOGIN_AS.includes(as as PrincipalKind)) {
      throw new AuthError("BAD_REQUEST", "as must be player, agent_member or staff");
    }
    const kind = as as PrincipalKind;
    const where = { telegramUserId: identity.id };
    const row =
      kind === "player"
        ? await this.db.player.findUnique({ where, select: { id: true } })
        : kind === "agent_member"
          ? await this.db.agentMember.findUnique({ where, select: { id: true } })
          : await this.db.staff.findUnique({ where, select: { id: true } });
    const principal = row ? await this.sessions.principalFor(kind, row.id) : null;

    if (!row || !principal) {
      await audit(this.db, {
        action: "auth.login_failed",
        target: `telegram:${identity.id}`,
        after: { as: kind, reason: row ? "inactive" : "no_account" },
        ip: meta.ip,
      });
      throw new AuthError("NO_ACCOUNT", `no active ${kind.replace("_", " ")} account for this Telegram user`);
    }
    const { token, expiresAt } = await this.sessions.create({ kind, id: row.id, ...meta });
    await audit(this.db, { actorKind: kind, actorId: row.id.toString(), action: "auth.login", ip: meta.ip });
    return { token, expiresAt, principal };
  }

  async logout(token: string, principal: Principal, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(token);
    await audit(this.db, { ...actorOf(principal), action: "auth.logout", ip: meta.ip });
  }

  /**
   * Website sign-up, step 1: a one-time code that carries the referral into
   * the bot (`/start w_<code>`). Only its hash is stored.
   */
  async startWebSignup(ref: unknown): Promise<{ code: string; expiresAt: Date }> {
    let referralSlug: string | null = null;
    if (ref !== undefined && ref !== null && ref !== "") {
      const agent = typeof ref === "string" ? await this.db.agent.findUnique({ where: { slug: ref } }) : null;
      if (!agent || agent.status !== "active" || agent.isCompany) {
        throw new AuthError("INVALID_REFERRAL", "this referral link is not valid");
      }
      referralSlug = agent.slug;
    }
    // 18 bytes → 24 base64url chars: "w_" + code fits Telegram's 64-char start payload.
    const code = randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + WEB_CODE_TTL_MS);
    await this.db.webSignup.create({ data: { codeHash: sha256(code), referralSlug, expiresAt } });
    return { code, expiresAt };
  }

  /**
   * Website sign-up, step 3: "pending" until the bot has created the player,
   * then one session, once. The code is used up atomically, so two tabs
   * polling at once can't both get a session.
   */
  async webSignupStatus(
    code: unknown,
    meta: RequestMeta,
  ): Promise<{ status: "pending" } | ({ status: "done" } & LoginResult)> {
    if (typeof code !== "string" || code.length > 64)
      throw new AuthError("UNKNOWN_CODE", "unknown or expired code");
    const codeHash = sha256(code);
    const row = await this.db.webSignup.findUnique({ where: { codeHash } });
    if (!row || row.expiresAt.getTime() <= Date.now())
      throw new AuthError("UNKNOWN_CODE", "unknown or expired code");
    if (row.consumedAt) throw new AuthError("CODE_USED", "this sign-up link was already used");
    if (row.playerId === null) return { status: "pending" };

    const { count } = await this.db.webSignup.updateMany({
      where: { codeHash, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw new AuthError("CODE_USED", "this sign-up link was already used");
    const principal = await this.sessions.principalFor("player", row.playerId);
    if (!principal) throw new AuthError("NO_ACCOUNT", "this account is not active");
    const { token, expiresAt } = await this.sessions.create({ kind: "player", id: row.playerId, ...meta });
    await audit(this.db, {
      actorKind: "player",
      actorId: row.playerId.toString(),
      action: "auth.login",
      after: { via: "web_signup" },
      ip: meta.ip,
    });
    return { status: "done", token, expiresAt, principal };
  }
}

export function actorOf(p: Principal): { actorKind: string; actorId: string } {
  const id = p.kind === "staff" ? p.staffId : p.kind === "agent_member" ? p.memberId : p.playerId;
  return { actorKind: p.kind, actorId: id.toString() };
}
