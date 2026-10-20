import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { Agent, PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import type { Principal } from "../../src/auth/rbac";
import { Sessions } from "../../src/auth/sessions";
import { addConfigVersion } from "../../src/config/configVersions";
import { loadEnv } from "../../src/config/env";
import { PrismaService } from "../../src/db/prisma.service";
import { Ledger } from "../../src/ledger/ledger";
import { RulesError, rulesAt } from "../../src/settlement/rules";
import { Settlement, SettlementError } from "../../src/settlement/settlement";
import { ConfigController, settlementHttp } from "../../src/settlement/settlement.controller";
import { SettlementJob } from "../../src/settlement/settlement.module";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEYS, PHONE_KEY_PAIR } from "../keys";
import { TEST_DATABASE_URL, testPrisma } from "./testDb";

jest.setTimeout(300_000);

/**
 * All settlement tests live in this one file, in order: periods are global
 * and sequential. They run in 2030 so bets made by other test files (settled
 * "now") all fall into period 1, and our own agents' numbers are exact.
 */
const T0 = new Date("2030-01-01T00:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

let db: PrismaClient;
let ledger: Ledger;
let hierarchy: Hierarchy;
let players: Players;
let settlement: Settlement;
let app: INestApplication;
const owner: Principal = { kind: "staff", staffId: 1n, roles: ["owner"] };

beforeAll(async () => {
  db = testPrisma();
  ledger = new Ledger(db);
  hierarchy = new Hierarchy(db, ledger);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
  settlement = new Settlement(db, ledger);
  await addConfigVersion(db, {
    key: "settlement.first_period_start",
    value: T0.toISOString(),
    effectiveFrom: new Date("2026-10-20T00:00:01Z"),
    createdBy: "test",
  });
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...PHONE_KEYS,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PrismaService)
    .useValue(new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } }))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  expect(await ledger.checkInvariants()).toMatchObject({
    sumOfBalances: 0n,
    negativeViolations: [],
    ok: true,
  });
  await app.close();
  await db.$disconnect();
});

let n = 0;
let ph = 0;
let txn = 0;
const agent = (parentId?: bigint) =>
  hierarchy.createAgent({ slug: `st-${process.pid}-${++n}`, displayName: `S${n}`, parentId });
const player = (a: Agent) =>
  players.register({ phone: `+25198${String(1_000_000 + ++ph).slice(-7)}`, referralSlug: a.slug });
async function bet(
  a: Agent,
  p: { id: bigint },
  stake: bigint,
  win: bigint,
  settledAt: Date | null,
  status = "settled",
) {
  return db.bet.create({
    data: {
      providerId: "octhera",
      playerId: p.id,
      agentId: a.id,
      debitTxnId: `st-${process.pid}-${++txn}`,
      stake,
      win,
      status,
      settledAt,
    },
  });
}
const linesOf = async (periodId: bigint, a: Agent) =>
  Object.fromEntries(
    (await db.settlementLine.findMany({ where: { periodId, agentId: a.id } })).map((l) => [
      `${l.beneficiary}${l.parentLevel ?? ""}`,
      l.amount,
    ]),
  );
const balanceOf = async (type: string, ownerKind: string, ownerId: string) => {
  const acc = await ledger.openAccount({ type: type as never, ownerKind: ownerKind as never, ownerId });
  return ledger.getBalance(acc.id);
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof SettlementError ? e.code : String(e)),
  );

// The cast of the story.
let G1: Agent, G2: Agent, G3: Agent, A: Agent, B: Agent, C: Agent;
let aBet: { id: bigint }, bBet: { id: bigint };
let p1: bigint, p2: bigint;

describe("rules", () => {
  it("refuse to run before the launch date is configured", async () => {
    await expect(rulesAt(db, new Date("2026-10-19T00:00:00Z"))).rejects.toThrow(RulesError);
    expect(await code(settlement.ensurePeriods(new Date("2026-10-19T00:00:00Z")))).toBe("RULES");
    expect((await rulesAt(db, day(5))).split).toEqual({
      agentBp: 6000,
      companyBp: 1000,
      providerBp: 1000,
      parentsBp: [1000, 500, 500],
    });
  });
});

describe("period 1: the owner's worked example", () => {
  beforeAll(async () => {
    G1 = await agent();
    G2 = await agent(G1.id);
    G3 = await agent(G2.id);
    A = await agent(G3.id); // parents: G3 (1), G2 (2), G1 (3)
    B = await agent(G1.id); // only one parent
    C = await agent();
    const pa = await player(A);
    const pb = await player(B);
    const pc = await player(C);
    // A: stakes 50,000.00, winnings 39,234.57 incl. a refund → G = 10,765.43
    aBet = await bet(A, pa, 4_000_000n, 3_000_000n, day(2));
    await bet(A, pa, 1_000_000n, 800_000n, day(3));
    await bet(A, pa, 0n, 123_457n, day(4)); // refund, counted as winnings (Q-03)
    // B: the same G, but one parent.
    bBet = await bet(B, pb, 5_000_000n, 3_923_457n, day(5));
    // C: players won → G = −3,000.00
    await bet(C, pc, 100_000n, 400_000n, day(6));
    // An open bet and a bet settled after the period: neither counts in period 1.
    await bet(A, pa, 999_999n, 0n, null, "open");
    await bet(A, pa, 777_700n, 0n, day(12));
  });

  it("creates the periods that have started", async () => {
    expect(await settlement.ensurePeriods(day(15))).toBeGreaterThanOrEqual(2);
    expect(await settlement.ensurePeriods(day(15))).toBe(0);
    const periods = await settlement.list();
    expect(periods.map((p) => [p.startsAt.toISOString(), p.endsAt.toISOString()]).slice(0, 2)).toEqual([
      [day(0).toISOString(), day(10).toISOString()],
      [day(10).toISOString(), day(20).toISOString()],
    ]);
    [p1, p2] = periods.map((p) => p.id) as [bigint, bigint];
  });

  it("can't draft before the end, or out of order", async () => {
    expect(await code(settlement.draft(p1, owner, day(5)))).toBe("NOT_ENDED");
    expect(await code(settlement.draft(p2, owner, day(25)))).toBe("OUT_OF_ORDER");
    expect(await code(settlement.draft(999_999n, owner, day(25)))).toBe("NOT_FOUND");
    expect(await code(settlement.approve(p1, owner))).toBe("WRONG_STATE"); // not drafted yet
  });

  it("drafts the exact shares, and a redraft is identical", async () => {
    const d = await settlement.draft(p1, null, day(11));
    expect(d.status).toBe("draft");
    expect(d.config).toMatchObject({ "commission.split": expect.any(String) });
    const expectedA = {
      agent: 645_900n,
      provider: 107_600n,
      parent1: 107_600n,
      parent2: 53_800n,
      parent3: 53_800n,
      company: 107_843n,
    };
    expect(await linesOf(p1, A)).toEqual(expectedA);
    expect(await linesOf(p1, B)).toEqual({
      agent: 645_900n,
      provider: 107_600n,
      parent1: 107_600n,
      company: 215_443n,
    });
    expect(await linesOf(p1, C)).toEqual({ agent: -300_000n });
    const parents = await db.settlementLine.findMany({
      where: { periodId: p1, agentId: A.id, beneficiary: "parent" },
      orderBy: { parentLevel: "asc" },
    });
    expect(parents.map((l) => l.beneficiaryAgentId)).toEqual([G3.id, G2.id, G1.id]);
    await settlement.draft(p1, owner, day(11));
    expect(await linesOf(p1, A)).toEqual(expectedA);
  });

  it("approval moves the 40% out of the agent, once, and freezes the period", async () => {
    const before = await balanceOf("AGENT_CASH_POSITION", "agent", A.id.toString());
    const companyBefore = await balanceOf("COMPANY_REVENUE", "company", "company");
    const approved = await settlement.approve(p1, owner);
    expect(approved.status).toBe("approved");
    expect(await balanceOf("AGENT_CASH_POSITION", "agent", A.id.toString())).toBe(before - 430_643n);
    expect(await balanceOf("PARENT_PAYABLE", "agent", G3.id.toString())).toBe(107_600n);
    expect(await balanceOf("PARENT_PAYABLE", "agent", G1.id.toString())).toBe(53_800n + 107_600n); // P3 of A, P1 of B
    expect(await balanceOf("PROVIDER_FEES", "provider", "octhera")).toBeGreaterThanOrEqual(215_200n);
    expect((await balanceOf("COMPANY_REVENUE", "company", "company")) - companyBefore).toBeGreaterThanOrEqual(
      107_843n + 215_443n,
    );
    expect(await balanceOf("AGENT_CASH_POSITION", "agent", C.id.toString())).toBe(0n); // C's loss: nothing moves

    expect((await settlement.approve(p1, owner)).status).toBe("approved"); // twice: same
    expect(
      await db.ledgerTransaction.count({ where: { idempotencyKey: `settlement:${p1}:${A.id}:octhera` } }),
    ).toBe(1);
    expect(await db.settlementCounted.findUnique({ where: { betId: aBet.id } })).toMatchObject({
      stake: 4_000_000n,
      win: 3_000_000n,
    });

    const line = await db.settlementLine.findFirstOrThrow({ where: { periodId: p1, agentId: A.id } });
    await expect(db.settlementLine.update({ where: { id: line.id }, data: { amount: 1n } })).rejects.toThrow(
      /frozen/,
    );
    await expect(db.settlementLine.delete({ where: { id: line.id } })).rejects.toThrow(/frozen/);
    await expect(
      db.settlementPeriod.update({ where: { id: p1 }, data: { status: "draft" } }),
    ).rejects.toThrow(/frozen/);
    expect(await code(settlement.draft(p1, owner, day(30)))).toBe("WRONG_STATE");
  });

  it("statements show the shares and the netting instruction", async () => {
    const s = await settlement.statements(p1, A.id);
    expect(s.period.status).toBe("approved");
    expect(s.statements[0]?.lines.find((l) => l.beneficiary === "company")).toMatchObject({
      amountSantim: "107843",
      posted: true,
    });
    // These test bets were written directly, so no game money reached A's account; after
    // approval A owes the 40% shares (in real play the stakes would already be with A).
    expect(s.statements[0]?.netting).toMatchObject({
      cashPositionSantim: "-430643",
      instruction: "remit_to_company",
    });
    const g3 = await settlement.netting(G3.id);
    expect(g3).toEqual({
      cashPositionSantim: "0",
      parentPayableSantim: "107600",
      netSantim: "107600",
      instruction: "company_pays_agent",
    });
    expect((await settlement.netting(C.id)).instruction).toBe("settled");
    const mine = await settlement.agentStatements(A.id);
    expect(mine.periods).toHaveLength(1);
    expect(await code(settlement.statements(999_999n))).toBe("NOT_FOUND");
  });
});

describe("period 2: adjustments and stale drafts", () => {
  it("a rollback and a late win after approval become next-period adjustments", async () => {
    // A's 40,000 bet (win 30,000) is rolled back after period 1 was approved…
    await db.bet.update({ where: { id: aBet.id }, data: { status: "rolled_back", settledAt: day(13) } });
    // …and B's bet gets a late win of 1,000.00.
    await db.bet.update({ where: { id: bBet.id }, data: { win: 3_923_457n + 100_000n, settledAt: day(14) } });
    await settlement.draft(p2, owner, day(21));
    const a = await db.settlementLine.findMany({ where: { periodId: p2, agentId: A.id } });
    // A: −(40,000 − 30,000) from the rollback + 7,777 from the bet settled on day 12 → G = −2,223 → A carries it.
    expect(a.map((l) => [l.beneficiary, l.stakes, l.winnings, l.result])).toEqual([
      ["agent", 777_700n - 4_000_000n, -3_000_000n, -222_300n],
    ]);
    expect(await linesOf(p2, B)).toEqual({ agent: -100_000n });
  });

  it("refuses an approval if bets changed since the draft, until it is redrafted", async () => {
    const pc = await player(C);
    await bet(C, pc, 500_000n, 0n, day(15));
    expect(await code(settlement.approve(p2, owner))).toBe("STALE_DRAFT");
    await settlement.draft(p2, owner, day(21));
    // No parents: the three parent shares (20%) go to the company with its own 10%.
    expect(await linesOf(p2, C)).toEqual({ agent: 300_000n, provider: 50_000n, company: 150_000n });
    expect((await settlement.approve(p2, owner)).status).toBe("approved");
  });
});

describe("config endpoint pieces", () => {
  it("shows null for a rule that isn't configured, and passes database errors through", async () => {
    const fake = {
      configVersion: { findFirst: async () => null, create: () => Promise.reject(new Error("db down")) },
    } as never;
    const ctl = new ConfigController(fake);
    expect(await ctl.current()).toMatchObject({ "settlement.first_period_start": null });
    const req = { principal: owner, ip: "1.2.3.4" } as never;
    await expect(ctl.set(req, { key: "settlement.period_days", value: 10 })).rejects.toThrow("db down");
  });
});

describe("HTTP, config and the job", () => {
  let ownerTok: string;
  let supportTok: string;
  let memberTok: string;
  beforeAll(async () => {
    const sessions = new Sessions(db, 3_600_000);
    const o = await db.staff.create({ data: { displayName: "Owner" } });
    await db.staffRole.create({ data: { staffId: o.id, roleKey: "owner", grantedBy: "test" } });
    const s = await db.staff.create({ data: { displayName: "Support" } });
    await db.staffRole.create({ data: { staffId: s.id, roleKey: "support", grantedBy: "test" } });
    const m = await db.agentMember.create({ data: { agentId: A.id, displayName: "A member" } });
    ownerTok = (await sessions.create({ kind: "staff", id: o.id })).token;
    supportTok = (await sessions.create({ kind: "staff", id: s.id })).token;
    memberTok = (await sessions.create({ kind: "agent_member", id: m.id })).token;
  });
  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  it("owner routes, agent statements, and refusals", async () => {
    const periods = await http().get("/admin/settlement/periods").set(as(ownerTok));
    expect(periods.status).toBe(200);
    expect(periods.body.slice(0, 2).map((p: { status: string }) => p.status)).toEqual([
      "approved",
      "approved",
    ]);
    expect(
      (await http().get(`/admin/settlement/periods/${p1}/statements`).set(as(ownerTok))).body.statements
        .length,
    ).toBeGreaterThan(0);
    expect((await http().post(`/admin/settlement/periods/${p1}/approve`).set(as(ownerTok))).body.status).toBe(
      "approved",
    );
    expect((await http().post(`/admin/settlement/periods/${p1}/draft`).set(as(ownerTok))).status).toBe(409);
    expect((await http().get("/admin/settlement/periods/abc/statements").set(as(ownerTok))).status).toBe(404);
    expect((await http().get("/admin/settlement/periods").set(as(supportTok))).status).toBe(403);
    expect(
      (await http().get("/agent/statements").set(as(memberTok))).body.periods.length,
    ).toBeGreaterThanOrEqual(1);
    expect((await http().get("/agent/statements").set(as(ownerTok))).status).toBe(403);
  });

  it("the owner changes a rule from a date; past periods keep theirs", async () => {
    const current = await http().get("/admin/config").set(as(ownerTok));
    expect(current.body["commission.split"].value).toEqual({
      agentBp: 6000,
      companyBp: 1000,
      providerBp: 1000,
      parentsBp: [1000, 500, 500],
    });
    const post = (body: object) => http().post("/admin/config").set(as(ownerTok)).send(body);
    expect((await post({ key: "nope", value: 1 })).status).toBe(400);
    expect(
      (
        await post({
          key: "commission.split",
          value: { agentBp: 5000, companyBp: 1000, providerBp: 1000, parentsBp: [1000, 500, 500] },
        })
      ).status,
    ).toBe(400);
    expect((await post({ key: "settlement.period_days", value: 7, effectiveFrom: "soon" })).status).toBe(400);
    const newSplit = { agentBp: 5500, companyBp: 1500, providerBp: 1000, parentsBp: [1000, 500, 500] };
    const ok = await post({ key: "commission.split", value: newSplit, effectiveFrom: day(40).toISOString() });
    expect(ok.status).toBe(201);
    expect(
      (await post({ key: "commission.split", value: newSplit, effectiveFrom: day(40).toISOString() })).status,
    ).toBe(409);
    expect((await rulesAt(db, day(5))).split.agentBp).toBe(6000); // history unchanged
    expect((await rulesAt(db, day(45))).split.agentBp).toBe(5500);
    expect(
      await db.auditLog.count({ where: { action: "config.changed", target: "config:commission.split" } }),
    ).toBe(1);
    expect((await http().post("/admin/config").set(as(supportTok)).send({})).status).toBe(403);
    expect((await post({ key: "settlement.rounding_unit_santim", value: 1 })).status).toBe(201); // effective now
    // A version dated before any other: there is no previous value to audit.
    expect(
      (await post({ key: "settlement.period_days", value: 10, effectiveFrom: "2020-01-01T00:00:00Z" }))
        .status,
    ).toBe(201);
  });

  it("the job creates and drafts ended periods, never approves, and stays quiet before launch", async () => {
    const job = app.get(SettlementJob);
    await job.tick(day(31)); // period 3 (day 20–30) has ended → drafted
    const p3 = (await settlement.list()).find((p) => p.startsAt.getTime() === day(20).getTime());
    expect(p3?.status).toBe("draft");
    const listed = await request(app.getHttpServer()).get("/admin/settlement/periods").set(as(ownerTok));
    expect(listed.body.find((p: { id: string }) => p.id === p3?.id.toString())).toMatchObject({
      status: "draft",
      approvedAt: null,
    });
    await job.tick(day(32)); // already drafted: nothing new
    await job.tick(new Date("2026-10-19T00:00:00Z")); // before launch: RULES, silent
    await new SettlementJob(
      { ensurePeriods: () => Promise.reject(new Error("db down")) } as never,
      { NODE_ENV: "test" } as never,
    ).tick();
    jest.useFakeTimers();
    const live = new SettlementJob(
      { ensurePeriods: jest.fn(async () => 0), list: jest.fn(async () => []) } as never,
      { NODE_ENV: "production" } as never,
    );
    live.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);
    live.onModuleDestroy();
    jest.useRealTimers();
  });

  it("maps errors to HTTP and passes others through", () => {
    const status = (e: unknown) => {
      try {
        settlementHttp(e);
      } catch (x) {
        return (x as { getStatus?: () => number }).getStatus?.() ?? "raw";
      }
    };
    expect(status(new RulesError("x"))).toBe(400);
    expect(status(new SettlementError("NOT_FOUND", "x"))).toBe(404);
    expect(status(new SettlementError("RULES", "x"))).toBe(503);
    expect(status(new SettlementError("STALE_DRAFT", "x"))).toBe(409);
    expect(status(new Error("raw"))).toBe("raw");
  });

  it("listing periods before launch is fine; unexpected errors still surface", async () => {
    expect(await settlement.ensurePeriodsIfConfigured(new Date("2026-10-19T00:00:00Z"))).toBe(0);
    const noRules = new Settlement(
      { configVersion: { findFirst: () => Promise.reject(new Error("config down")) } } as never,
      ledger,
    );
    await expect(noRules.ensurePeriods(day(5))).rejects.toThrow("config down");
    const brokenFirst = new Settlement(
      {
        settlementPeriod: { findFirst: () => Promise.reject(new Error("db down")) },
        configVersion: db.configVersion,
      } as never,
      ledger,
    );
    await expect(brokenFirst.ensurePeriodsIfConfigured(day(5))).rejects.toThrow("db down");
    const broken = new Settlement(
      {
        settlementPeriod: { findFirst: () => Promise.reject(new Error("db down")) },
        configVersion: db.configVersion,
      } as never,
      ledger,
    );
    await expect(broken.ensurePeriods(day(5))).rejects.toThrow("db down");
  });
});
