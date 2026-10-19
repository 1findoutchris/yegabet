import type { Prisma } from "@prisma/client";

/**
 * Who may do what (CLAUDE.md §5.2, §7 "RBAC on every endpoint; deny by
 * default"). The matrix is plan 03's proposal until the owner answers Q-17.
 *
 * Row scopes are returned as Prisma `where` filters, so callers filter in the
 * query instead of fetching everything and filtering afterwards.
 */

export const PERMISSIONS = [
  "agents.read.all",
  "agents.create",
  "players.read.all",
  "players.read.own",
  "agents.children.summary",
  "config.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = ["owner", "cofounder", "finance", "support", "staff_reviewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: ["agents.read.all", "agents.create", "players.read.all", "config.write"],
  cofounder: ["agents.read.all", "agents.create", "players.read.all"],
  finance: ["agents.read.all", "players.read.all"],
  support: ["agents.read.all", "players.read.all"],
  staff_reviewer: ["agents.read.all"],
};

/** Agent members (the people running a store) get only their own scope. */
export const AGENT_MEMBER_PERMISSIONS: readonly Permission[] = [
  "players.read.own",
  "agents.children.summary",
];

/** Set on the request by the login layer (Task 04). Never built from client input. */
export type Principal =
  | { kind: "staff"; staffId: bigint; roles: StaffRole[] }
  | { kind: "agent_member"; memberId: bigint; agentId: bigint }
  | { kind: "player"; playerId: bigint };

export function can(principal: Principal | undefined, permission: Permission): boolean {
  if (!principal) return false;
  if (principal.kind === "agent_member") return AGENT_MEMBER_PERMISSIONS.includes(permission);
  // Players act only on their own account, through routes that use their id;
  // none of the staff/agent permissions apply to them.
  if (principal.kind === "player") return false;
  return principal.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}

export class ForbiddenError extends Error {
  constructor(readonly permission: string) {
    super(`not allowed: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Which player rows the principal may read in detail. Staff with
 * players.read.all: every player. An agent member: only players whose current
 * agent is their own agent. Never a child agent's players (§5.2).
 */
export function playerScope(principal: Principal | undefined): Prisma.PlayerWhereInput {
  if (can(principal, "players.read.all")) return {};
  if (principal?.kind === "agent_member" && can(principal, "players.read.own")) {
    return { agentId: principal.agentId };
  }
  throw new ForbiddenError("players.read");
}

/**
 * Which agents' figures the principal may see **as totals only**: every agent
 * below their own. Callers must aggregate (sum/count). Returning these agents'
 * player rows would break §5.2.
 */
export function childSummaryScope(principal: Principal | undefined): Prisma.AgentWhereInput {
  if (principal?.kind === "agent_member" && can(principal, "agents.children.summary")) {
    return { ancestors: { has: principal.agentId } };
  }
  throw new ForbiddenError("agents.children.summary");
}
