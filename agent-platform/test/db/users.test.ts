import fc from "fast-check";
import type { Agent, PrismaClient } from "@prisma/client";
import { ACCOUNT_TYPES } from "../../src/ledger/accountTypes";
import { Ledger } from "../../src/ledger/ledger";
import { playerScope, childSummaryScope } from "../../src/auth/rbac";
import { UsersError } from "../../src/users/errors";
import { AGENT_ACCOUNT_TYPES, Hierarchy } from "../../src/users/hierarchy";
import { decryptPhone } from "../../src/users/phone";
import { PLAYER_ACCOUNT_TYPES, Players } from "../../src/users/players";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

let db: PrismaClient;
let ledger: Ledger;
let hierarchy: Hierarchy;
let players: Players;

beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db);
  hierarchy = new Hierarchy(db, ledger);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
});
afterAll(async () => {
  expect((await ledger.checkInvariants()).ok).toBe(true);
  await db.$disconnect();
});

jest.setTimeout(120_000);

let n = 0;
const slug = (p: string) => `${p}-${process.pid}-${++n}`.toLowerCase().slice(0, 40);
let phoneSeq = 100_000;
/** A fresh valid Ethiopian number per call. */
const phone = () => `09${String(10_000_000 + ++phoneSeq).slice(-8)}`;

async function accountsOf(ownerKind: string, ownerId: bigint) {
  return db.account.findMany({
    where: { ownerKind, ownerId: ownerId.toString() },
    include: { balance: true },
    orderBy: { type: "asc" },
  });
}

describe("seed", () => {
  it("has exactly one company agent, with company and agent accounts matching ACCOUNT_TYPES", async () => {
    const companies = await db.agent.findMany({ where: { isCompany: true } });
    expect(companies).toHaveLength(1);
    const company = companies[0] as Agent;
    expect(company).toMatchObject({ slug: "company", parentId: null, depth: 0, status: "active" });
    expect((await hierarchy.companyAgent()).id).toBe(company.id);

    const seeded = [
      ...(await db.account.findMany({ where: { ownerKind: "company", ownerId: "company" } })),
      ...(await accountsOf("agent", company.id)),
    ];
    expect(seeded.map((a) => a.type).sort()).toEqual(
      ["COMPANY_FLOAT", "COMPANY_REVENUE", ...AGENT_ACCOUNT_TYPES].sort(),
    );
    for (const a of seeded) {
      expect(a.allowNegative).toBe(ACCOUNT_TYPES[a.type as keyof typeof ACCOUNT_TYPES].allowNegative);
      expect(await ledger.getBalance(a.id)).toBe(0n);
    }
    expect((await db.role.findMany()).map((r) => r.key).sort()).toEqual(
      ["cofounder", "finance", "owner", "staff_reviewer", "support"].sort(),
    );
  });
});

describe("hierarchy A → B → C → D", () => {
  let A: Agent, B: Agent, C: Agent, D: Agent;

  beforeAll(async () => {
    A = await hierarchy.createAgent({ slug: slug("a"), displayName: "A" });
    B = await hierarchy.createAgent({ slug: slug("b"), displayName: "B", parentId: A.id });
    C = await hierarchy.createAgent({ slug: slug("c"), displayName: "C", parentId: B.id });
    D = await hierarchy.createAgent({ slug: slug("d"), displayName: "  D  ", parentId: C.id });
  });

  it("stores the path computed by the database", async () => {
    expect(A).toMatchObject({ ancestors: [], depth: 0 });
    expect(D).toMatchObject({ ancestors: [A.id, B.id, C.id], depth: 3, displayName: "D" });
    expect(await hierarchy.ancestors(D.id)).toEqual([A.id, B.id, C.id]);
  });

  it("finds parents by level and returns null past the root", async () => {
    expect(await hierarchy.parentAt(D.id, 1)).toBe(C.id);
    expect(await hierarchy.parentAt(D.id, 2)).toBe(B.id);
    expect(await hierarchy.parentAt(D.id, 3)).toBe(A.id);
    expect(await hierarchy.parentAt(D.id, 4)).toBeNull();
    expect(await hierarchy.parentAt(A.id, 1)).toBeNull();
    await expect(hierarchy.parentAt(D.id, 0)).rejects.toThrow(/level/);
  });

  it("lists a subtree without the agent itself", async () => {
    expect(await hierarchy.subtree(B.id)).toEqual([C.id, D.id]);
    expect(await hierarchy.subtree(D.id)).toEqual([]);
  });

  it("opens the three agent accounts at zero and posts nothing", async () => {
    const accounts = await accountsOf("agent", B.id);
    expect(accounts.map((a) => a.type).sort()).toEqual([...AGENT_ACCOUNT_TYPES].sort());
    expect(accounts.every((a) => a.balance?.balance === 0n)).toBe(true);
    const entries = await db.ledgerEntry.count({
      where: {
        OR: [
          { debitAccountId: { in: accounts.map((a) => a.id) } },
          { creditAccountId: { in: accounts.map((a) => a.id) } },
        ],
      },
    });
    expect(entries).toBe(0);
  });

  it("refuses any change to the hierarchy, and deleting an agent", async () => {
    await expect(db.agent.update({ where: { id: D.id }, data: { parentId: A.id } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.agent.update({ where: { id: D.id }, data: { ancestors: [] } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.agent.update({ where: { id: A.id }, data: { isCompany: true } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.agent.delete({ where: { id: D.id } })).rejects.toThrow(/never deleted/);
    // Status and display name may change.
    await db.agent.update({ where: { id: D.id }, data: { displayName: "D2" } });
  });

  it("refuses a bad parent: missing, paused, or the company agent", async () => {
    await expect(
      hierarchy.createAgent({ slug: slug("x"), displayName: "X", parentId: 999_999_999n }),
    ).rejects.toMatchObject({
      code: "INVALID_PARENT",
    });
    const company = await hierarchy.companyAgent();
    await expect(
      hierarchy.createAgent({ slug: slug("x"), displayName: "X", parentId: company.id }),
    ).rejects.toMatchObject({
      code: "INVALID_PARENT",
      message: "the company agent cannot be a parent",
    });
    const paused = await hierarchy.createAgent({ slug: slug("p"), displayName: "P" });
    await db.agent.update({ where: { id: paused.id }, data: { status: "paused" } });
    await expect(
      hierarchy.createAgent({ slug: slug("x"), displayName: "X", parentId: paused.id }),
    ).rejects.toMatchObject({
      code: "INVALID_PARENT",
    });
  });

  it("refuses a duplicate slug, a bad slug, an empty name, a second company and a company with a parent", async () => {
    await expect(hierarchy.createAgent({ slug: A.slug, displayName: "again" })).rejects.toMatchObject({
      code: "SLUG_TAKEN",
    });
    await expect(hierarchy.createAgent({ slug: "No Caps!", displayName: "x" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(hierarchy.createAgent({ slug: slug("e"), displayName: " " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      db.agent.create({ data: { slug: slug("co"), displayName: "Co2", isCompany: true } }),
    ).rejects.toThrow();
    await expect(
      db.agent.create({ data: { slug: slug("co"), displayName: "Co3", isCompany: true, parentId: A.id } }),
    ).rejects.toThrow();
    await expect(hierarchy.get(999_999_999n)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hierarchy.subtree(999_999_999n)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates an unexpected database error unchanged", async () => {
    const broken = new Hierarchy(db, {
      openAccount: () => Promise.reject(new Error("disk full")),
    } as unknown as Ledger);
    await expect(broken.createAgent({ slug: slug("z"), displayName: "Z" })).rejects.toThrow("disk full");
    expect(await db.agent.count({ where: { displayName: "Z" } })).toBe(0); // rolled back
  });

  describe("players and access", () => {
    it("a player with no referral belongs to the company agent; with B's slug, to B", async () => {
      const company = await hierarchy.companyAgent();
      const direct = await players.register({ phone: phone() });
      const referred = await players.register({
        phone: phone(),
        referralSlug: B.slug,
        telegramUserId: `tg-${n}`,
      });
      expect(direct.agentId).toBe(company.id);
      expect(referred.agentId).toBe(B.id);
      expect(await players.currentAgentId(direct.id)).toBe(company.id);
      expect(await players.currentAgentId(referred.id)).toBe(B.id);
      expect(await db.agentAssignment.count({ where: { playerId: referred.id, effectiveTo: null } })).toBe(1);

      const accounts = await accountsOf("player", referred.id);
      expect(accounts.map((a) => a.type).sort()).toEqual([...PLAYER_ACCOUNT_TYPES].sort());
      expect(accounts.every((a) => a.balance?.balance === 0n)).toBe(true);
    });

    it("never stores the phone in plain text, and finds the player from any format", async () => {
      const num = phone(); // e.g. 0910100007
      const p = await players.register({ phone: num });
      const row = await db.player.findUniqueOrThrow({ where: { id: p.id } });
      const stored = JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? String(v) : v));
      expect(stored).not.toContain(num.slice(1)); // the 9 significant digits appear nowhere
      const e164 = decryptPhone(row.phoneEnc, PHONE_KEY_PAIR.encKey);
      expect(e164).toBe(`+251${num.slice(1)}`);
      expect((await players.findByPhone(`+251 ${num.slice(1)}`))?.id).toBe(p.id);
      expect(await players.findByPhone("0999999999")).toBeNull();
    });

    it("one account per phone, whatever the format; one per Telegram account", async () => {
      const num = phone();
      await players.register({ phone: num, telegramUserId: `tg-dup-${n}` });
      await expect(players.register({ phone: `+251${num.slice(1)}` })).rejects.toMatchObject({
        code: "PHONE_TAKEN",
      });
      await expect(players.register({ phone: phone(), telegramUserId: `tg-dup-${n}` })).rejects.toMatchObject(
        {
          code: "TELEGRAM_TAKEN",
        },
      );
    });

    it("refuses an unknown or paused referral link, and a bad phone, writing nothing", async () => {
      const before = await db.player.count();
      await expect(players.register({ phone: phone(), referralSlug: "no-such-agent" })).rejects.toMatchObject(
        {
          code: "INVALID_REFERRAL",
        },
      );
      const paused = await hierarchy.createAgent({ slug: slug("pp"), displayName: "PP" });
      await db.agent.update({ where: { id: paused.id }, data: { status: "paused" } });
      await expect(players.register({ phone: phone(), referralSlug: paused.slug })).rejects.toBeInstanceOf(
        UsersError,
      );
      await expect(players.register({ phone: "123" })).rejects.toMatchObject({ code: "INVALID_PHONE" });
      expect(await db.player.count()).toBe(before);
      await expect(players.currentAgentId(999_999_999n)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rolls the whole registration back if opening accounts fails", async () => {
      const broken = new Players(
        db,
        { openAccount: () => Promise.reject(new Error("boom")) } as unknown as Ledger,
        PHONE_KEY_PAIR,
      );
      const num = phone();
      await expect(broken.register({ phone: num })).rejects.toThrow("boom");
      expect(await players.findByPhone(num)).toBeNull();
    });

    it("assignment history is append-only: only closing it once is allowed", async () => {
      const p = await players.register({ phone: phone() });
      const row = await db.agentAssignment.findFirstOrThrow({ where: { playerId: p.id } });
      await expect(
        db.agentAssignment.update({ where: { id: row.id }, data: { agentId: A.id } }),
      ).rejects.toThrow(/immutable/);
      await expect(db.agentAssignment.delete({ where: { id: row.id } })).rejects.toThrow(/immutable/);
      await expect(
        db.agentAssignment.create({ data: { playerId: p.id, agentId: A.id, reason: "transfer" } }),
      ).rejects.toThrow(); // a second *current* row
      await db.agentAssignment.update({ where: { id: row.id }, data: { effectiveTo: new Date() } });
      await expect(
        db.agentAssignment.update({ where: { id: row.id }, data: { effectiveTo: new Date() } }),
      ).rejects.toThrow(/immutable/);
    });

    it("scopes: B's member reads B's players only, and C/D only as totals", async () => {
      const bPlayer = await players.register({ phone: phone(), referralSlug: B.slug });
      const cPlayer = await players.register({ phone: phone(), referralSlug: C.slug });
      const memberOfB = { kind: "agent_member" as const, memberId: 1n, agentId: B.id };

      const visible = await db.player.findMany({ where: playerScope(memberOfB), select: { id: true } });
      expect(visible.map((p) => p.id)).toContain(bPlayer.id);
      expect(visible.map((p) => p.id)).not.toContain(cPlayer.id);

      const children = await db.agent.findMany({ where: childSummaryScope(memberOfB), select: { id: true } });
      expect(children.map((c) => c.id)).toEqual([C.id, D.id]);
      const totals = await db.player.groupBy({
        by: ["agentId"],
        where: { agentId: { in: children.map((c) => c.id) } },
        _count: true,
      });
      expect(totals.find((t) => t.agentId === C.id)?._count).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("property: random trees", () => {
  it("every agent's stored path equals walking parent_id up to the root (30 runs)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 12 }), async (picks) => {
        const created: Agent[] = [];
        for (const pick of picks) {
          // Each new agent hangs under a random earlier one, or is a new root.
          const parent = created.length > 0 && pick % 3 !== 0 ? created[pick % created.length] : undefined;
          created.push(
            await hierarchy.createAgent({ slug: slug("t"), displayName: "t", parentId: parent?.id }),
          );
        }
        const byId = new Map(created.map((a) => [a.id, a]));
        for (const a of created) {
          const walked: bigint[] = [];
          for (let p = a.parentId; p !== null; p = (byId.get(p) as Agent).parentId) walked.unshift(p);
          expect(a.ancestors).toEqual(walked);
          expect(a.depth).toBe(walked.length);
        }
      }),
      { numRuns: 30 },
    );
  });
});
