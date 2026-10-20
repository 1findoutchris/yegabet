import {
  ForbiddenError,
  PERMISSIONS,
  STAFF_ROLES,
  can,
  childSummaryScope,
  playerScope,
  type Permission,
  type Principal,
  type StaffRole,
} from "../../src/auth/rbac";

const staff = (...roles: StaffRole[]): Principal => ({ kind: "staff", staffId: 1n, roles });
const member: Principal = { kind: "agent_member", memberId: 5n, agentId: 42n };

// Plan 03 §5 matrix, written out independently of ROLE_PERMISSIONS so a change
// to either one shows up here.
const MATRIX: Record<Permission, (StaffRole | "agent_member")[]> = {
  "agents.read.all": ["owner", "cofounder", "finance", "support", "staff_reviewer"],
  "agents.create": ["owner", "cofounder"],
  "players.read.all": ["owner", "cofounder", "finance", "support"],
  "players.read.own": ["agent_member"],
  "agents.children.summary": ["agent_member"],
  "config.write": ["owner"],
  "deposits.review.own": ["agent_member"],
  "deposits.override": ["owner"],
  "payment_accounts.manage.own": ["agent_member"],
  "withdrawals.review.own": ["agent_member"],
  "withdrawals.override": ["owner"],
};

describe("permission matrix", () => {
  const who: (StaffRole | "agent_member")[] = [...STAFF_ROLES, "agent_member"];
  for (const permission of PERMISSIONS) {
    for (const w of who) {
      const allowed = MATRIX[permission].includes(w);
      it(`${w} ${allowed ? "may" : "may NOT"} ${permission}`, () => {
        const principal = w === "agent_member" ? member : staff(w);
        expect(can(principal, permission)).toBe(allowed);
      });
    }
  }

  it("gives a player none of the staff or agent permissions", () => {
    const player: Principal = { kind: "player", playerId: 7n };
    for (const p of PERMISSIONS) expect(can(player, p)).toBe(false);
    expect(() => playerScope(player)).toThrow(ForbiddenError);
    expect(() => childSummaryScope(player)).toThrow(ForbiddenError);
  });

  it("denies an anonymous caller everything", () => {
    for (const p of PERMISSIONS) expect(can(undefined, p)).toBe(false);
  });

  it("combines roles, and ignores a role it doesn't know", () => {
    expect(can(staff("staff_reviewer", "owner"), "config.write")).toBe(true);
    expect(can(staff("ghost" as StaffRole), "agents.read.all")).toBe(false);
    expect(can(staff(), "agents.read.all")).toBe(false);
  });
});

describe("row scopes", () => {
  it("staff who may read all players get no filter", () => {
    expect(playerScope(staff("support"))).toEqual({});
  });

  it("an agent member sees only their own agent's players", () => {
    expect(playerScope(member)).toEqual({ agentId: 42n });
  });

  it("anyone else is refused player rows", () => {
    expect(() => playerScope(staff("staff_reviewer"))).toThrow(ForbiddenError);
    expect(() => playerScope(undefined)).toThrow(ForbiddenError);
  });

  it("child summaries cover every agent below the member's agent, and only for members", () => {
    expect(childSummaryScope(member)).toEqual({ ancestors: { has: 42n } });
    expect(() => childSummaryScope(staff("owner"))).toThrow(ForbiddenError);
    expect(() => childSummaryScope(undefined)).toThrow(/agents.children.summary/);
  });
});
