import { Prisma, PrismaClient } from "@prisma/client";
import { audit } from "../auth/audit";
import { actorOf } from "../auth/auth.service";
import { STAFF_ROLES, type Principal, type StaffRole } from "../auth/rbac";
import { isEnabled, setFlag } from "../config/featureFlags";
import { DEPOSITS_FLAG } from "../deposits/deposits";
import { GAMES_FLAG } from "../providers/games";
import { SIGNUP_FLAG } from "../telegram/bot";
import { UsersError } from "../users/errors";
import type { Hierarchy } from "../users/hierarchy";
import { WITHDRAWALS_FLAG } from "../withdrawals/withdrawals";

/**
 * Owner admin for the agent network (plan 08 lite): agents, the people who
 * run them, staff, and the launch switches. No money moves here; every change
 * is audited with before/after.
 */

/** The launch switches the owner turns on (off by default, CLAUDE.md §8). */
export const LAUNCH_FLAGS = [SIGNUP_FLAG, DEPOSITS_FLAG, WITHDRAWALS_FLAG, GAMES_FLAG] as const;

export type AdminErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "REFUSED";

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

const AGENT_STATUSES = ["active", "paused", "closed"] as const;
const PERSON_STATUSES = ["active", "disabled"] as const;
const telegramId = (v: unknown): string => {
  if (typeof v !== "string" && typeof v !== "number")
    throw new AdminError("INVALID_INPUT", "telegramUserId is required");
  const s = String(v).trim();
  if (!/^\d{4,20}$/.test(s))
    throw new AdminError("INVALID_INPUT", "telegramUserId must be the numeric Telegram id");
  return s;
};
const name = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 2 || s.length > 80) throw new AdminError("INVALID_INPUT", "displayName: 2–80 characters");
  return s;
};
const isP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export interface LinkConfig {
  botUsername?: string;
  domain: string;
}

export class Admin {
  constructor(
    private readonly db: PrismaClient,
    private readonly hierarchy: Hierarchy,
    private readonly links: LinkConfig,
  ) {}

  referralLinks(slug: string) {
    return {
      telegram: this.links.botUsername ? `https://t.me/${this.links.botUsername}?start=${slug}` : null,
      website: `https://${this.links.domain}/?ref=${slug}`,
    };
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  async createAgent(
    principal: Principal,
    input: { slug?: unknown; displayName?: unknown; parentId?: unknown },
    ip?: string,
  ) {
    const parentId =
      input.parentId === undefined || input.parentId === null || input.parentId === ""
        ? undefined
        : /^\d{1,18}$/.test(String(input.parentId))
          ? BigInt(String(input.parentId))
          : null;
    if (parentId === null) throw new AdminError("INVALID_INPUT", "parentId must be an agent id");
    try {
      const agent = await this.hierarchy.createAgent({
        slug: String(input.slug ?? ""),
        displayName: String(input.displayName ?? ""),
        parentId,
      });
      await audit(this.db, {
        ...actorOf(principal),
        action: "agent.created",
        target: `agent:${agent.id}`,
        after: { slug: agent.slug, parentId: agent.parentId?.toString() ?? null, depth: agent.depth },
        ip,
      });
      return { ...agentView(agent), links: this.referralLinks(agent.slug) };
    } catch (e) {
      if (e instanceof UsersError) {
        throw new AdminError(e.code === "SLUG_TAKEN" ? "CONFLICT" : "INVALID_INPUT", e.message);
      }
      throw e;
    }
  }

  async listAgents(q: { search?: unknown; status?: unknown }) {
    const where: Prisma.AgentWhereInput = {
      ...(typeof q.status === "string" && q.status ? { status: q.status } : {}),
      ...(typeof q.search === "string" && q.search
        ? {
            OR: [
              { slug: { contains: q.search.slice(0, 40), mode: "insensitive" } },
              { displayName: { contains: q.search.slice(0, 40), mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const agents = await this.db.agent.findMany({
      where,
      orderBy: { id: "asc" },
      take: 500,
      include: {
        parent: { select: { slug: true } },
        _count: { select: { players: true, members: true } },
      },
    });
    return agents.map((a) => ({
      ...agentView(a),
      parentSlug: a.parent?.slug ?? null,
      players: a._count.players,
      members: a._count.members,
      links: this.referralLinks(a.slug),
    }));
  }

  async setAgentStatus(principal: Principal, id: bigint, status: unknown, ip?: string) {
    if (!AGENT_STATUSES.includes(status as never))
      throw new AdminError("INVALID_INPUT", "status: active, paused or closed");
    const agent = await this.db.agent.findUnique({ where: { id } });
    if (!agent) throw new AdminError("NOT_FOUND", "no such agent");
    if (agent.isCompany && status !== "active") {
      throw new AdminError(
        "REFUSED",
        "the company agent owns every direct player and can't be paused or closed",
      );
    }
    const updated = await this.db.agent.update({ where: { id }, data: { status: status as string } });
    await audit(this.db, {
      ...actorOf(principal),
      action: "agent.status",
      target: `agent:${id}`,
      before: { status: agent.status },
      after: { status: updated.status },
      ip,
    });
    return agentView(updated);
  }

  // ── Agent members ─────────────────────────────────────────────────────────

  async addMember(
    principal: Principal,
    agentId: bigint,
    input: { telegramUserId?: unknown; displayName?: unknown },
    ip?: string,
  ) {
    const tg = telegramId(input.telegramUserId);
    const displayName = name(input.displayName);
    const agent = await this.db.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.status === "closed") throw new AdminError("NOT_FOUND", "no such open agent");
    try {
      const m = await this.db.agentMember.create({ data: { agentId, displayName, telegramUserId: tg } });
      await audit(this.db, {
        ...actorOf(principal),
        action: "agent_member.added",
        target: `agent_member:${m.id}`,
        after: { agentId: agentId.toString(), telegramUserId: tg },
        ip,
      });
      return memberView(m);
    } catch (e) {
      if (isP2002(e)) throw new AdminError("CONFLICT", "this Telegram account already runs an agent");
      throw e;
    }
  }

  async listMembers(agentId: bigint) {
    return (await this.db.agentMember.findMany({ where: { agentId }, orderBy: { id: "asc" } })).map(
      memberView,
    );
  }

  async setMemberStatus(principal: Principal, id: bigint, status: unknown, ip?: string) {
    if (!PERSON_STATUSES.includes(status as never))
      throw new AdminError("INVALID_INPUT", "status: active or disabled");
    const m = await this.db.agentMember.findUnique({ where: { id } });
    if (!m) throw new AdminError("NOT_FOUND", "no such member");
    const updated = await this.db.agentMember.update({ where: { id }, data: { status: status as string } });
    await audit(this.db, {
      ...actorOf(principal),
      action: "agent_member.status",
      target: `agent_member:${id}`,
      before: { status: m.status },
      after: { status: updated.status },
      ip,
    });
    return memberView(updated);
  }

  // ── Staff ─────────────────────────────────────────────────────────────────

  async listStaff() {
    const staff = await this.db.staff.findMany({
      orderBy: { id: "asc" },
      include: { roles: { select: { roleKey: true } } },
    });
    return staff.map((s) => ({ ...staffView(s), roles: s.roles.map((r) => r.roleKey) }));
  }

  /** Add a staff member, or give an existing one another role (idempotent). */
  async addStaff(
    principal: Principal,
    input: { telegramUserId?: unknown; displayName?: unknown; role?: unknown },
    ip?: string,
  ) {
    const tg = telegramId(input.telegramUserId);
    const displayName = name(input.displayName);
    if (!STAFF_ROLES.includes(input.role as StaffRole)) {
      throw new AdminError("INVALID_INPUT", `role: ${STAFF_ROLES.join(", ")}`);
    }
    const role = input.role as StaffRole;
    const staff = await this.db.staff.upsert({
      where: { telegramUserId: tg },
      create: { telegramUserId: tg, displayName },
      update: {},
    });
    await this.db.staffRole.upsert({
      where: { staffId_roleKey: { staffId: staff.id, roleKey: role } },
      create: { staffId: staff.id, roleKey: role, grantedBy: actorOf(principal).actorId },
      update: {},
    });
    await audit(this.db, {
      ...actorOf(principal),
      action: "staff.role_granted",
      target: `staff:${staff.id}`,
      after: { role },
      ip,
    });
    return (await this.listStaff()).find((s) => s.id === staff.id.toString());
  }

  async setStaffStatus(principal: Principal, id: bigint, status: unknown, ip?: string) {
    if (!PERSON_STATUSES.includes(status as never))
      throw new AdminError("INVALID_INPUT", "status: active or disabled");
    const s = await this.db.staff.findUnique({ where: { id }, include: { roles: true } });
    if (!s) throw new AdminError("NOT_FOUND", "no such staff member");
    if (status === "disabled" && s.roles.some((r) => r.roleKey === "owner")) {
      const owners = await this.db.staff.count({
        where: { status: "active", roles: { some: { roleKey: "owner" } } },
      });
      if (owners <= 1) throw new AdminError("REFUSED", "this is the last active owner");
    }
    const updated = await this.db.staff.update({ where: { id }, data: { status: status as string } });
    await audit(this.db, {
      ...actorOf(principal),
      action: "staff.status",
      target: `staff:${id}`,
      before: { status: s.status },
      after: { status: updated.status },
      ip,
    });
    return staffView(updated);
  }

  // ── Launch switches ───────────────────────────────────────────────────────

  async flags() {
    const out: Record<string, boolean> = {};
    for (const key of LAUNCH_FLAGS) out[key] = await isEnabled(this.db, key);
    return out;
  }

  async setFlag(principal: Principal, key: unknown, enabled: unknown, ip?: string) {
    if (!LAUNCH_FLAGS.includes(key as never) || typeof enabled !== "boolean") {
      throw new AdminError("INVALID_INPUT", `key: ${LAUNCH_FLAGS.join(", ")}; enabled: true or false`);
    }
    const before = await isEnabled(this.db, key as string);
    const actor = actorOf(principal);
    await setFlag(this.db, key as string, enabled, `${actor.actorKind}:${actor.actorId}`);
    await audit(this.db, {
      ...actor,
      action: "flag.changed",
      target: `flag:${key}`,
      before: { enabled: before },
      after: { enabled },
      ip,
    });
    return this.flags();
  }
}

function agentView(a: {
  id: bigint;
  slug: string;
  displayName: string;
  parentId: bigint | null;
  depth: number;
  isCompany: boolean;
  status: string;
}) {
  return {
    id: a.id.toString(),
    slug: a.slug,
    displayName: a.displayName,
    parentId: a.parentId?.toString() ?? null,
    depth: a.depth,
    isCompany: a.isCompany,
    status: a.status,
  };
}

function memberView(m: {
  id: bigint;
  agentId: bigint;
  displayName: string;
  telegramUserId: string | null;
  status: string;
}) {
  return {
    id: m.id.toString(),
    agentId: m.agentId.toString(),
    displayName: m.displayName,
    telegramUserId: m.telegramUserId,
    status: m.status,
  };
}

function staffView(s: { id: bigint; displayName: string; telegramUserId: string | null; status: string }) {
  return {
    id: s.id.toString(),
    displayName: s.displayName,
    telegramUserId: s.telegramUserId,
    status: s.status,
  };
}
