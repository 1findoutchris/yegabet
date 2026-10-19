import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Principal, StaffRole } from "./rbac";

export type PrincipalKind = Principal["kind"];

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * Login sessions (plan 04). The client gets a random token; the database only
 * ever sees its sha256. A session resolves to a principal only while it is
 * unexpired, unrevoked, and its person is still active.
 */
export class Sessions {
  constructor(
    private readonly db: PrismaClient,
    private readonly ttlMs: number,
  ) {}

  async create(input: {
    kind: PrincipalKind;
    id: bigint;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.session.create({
      data: {
        tokenHash: sha256(token),
        principalKind: input.kind,
        principalId: input.id,
        expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { token, expiresAt };
  }

  /** The principal for a token, or null (unknown, expired, revoked, or the person is no longer active). */
  async resolve(token: string | undefined): Promise<Principal | null> {
    if (!token || token.length > 200) return null;
    const s = await this.db.session.findUnique({ where: { tokenHash: sha256(token) } });
    if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) return null;
    return this.principalFor(s.principalKind as PrincipalKind, s.principalId);
  }

  /** Revokes the session for `token`. Returns whether one was open. */
  async revoke(token: string): Promise<boolean> {
    const { count } = await this.db.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  }

  /** Looks the person up fresh each time, so disabling someone takes effect immediately. */
  async principalFor(kind: PrincipalKind, id: bigint): Promise<Principal | null> {
    if (kind === "player") {
      const p = await this.db.player.findUnique({ where: { id }, select: { status: true } });
      return p?.status === "active" ? { kind: "player", playerId: id } : null;
    }
    if (kind === "agent_member") {
      const m = await this.db.agentMember.findUnique({
        where: { id },
        select: { status: true, agentId: true, agent: { select: { status: true } } },
      });
      return m?.status === "active" && m.agent.status === "active"
        ? { kind: "agent_member", memberId: id, agentId: m.agentId }
        : null;
    }
    const s = await this.db.staff.findUnique({
      where: { id },
      select: { status: true, roles: { select: { roleKey: true } } },
    });
    return s?.status === "active"
      ? { kind: "staff", staffId: id, roles: s.roles.map((r) => r.roleKey as StaffRole) }
      : null;
  }
}
