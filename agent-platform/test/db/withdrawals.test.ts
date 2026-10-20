import type { PrismaClient } from "@prisma/client";
import type { Principal } from "../../src/auth/rbac";
import { setFlag } from "../../src/config/featureFlags";
import { Ledger } from "../../src/ledger/ledger";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { WITHDRAWALS_FLAG, WithdrawalError, Withdrawals } from "../../src/withdrawals/withdrawals";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

jest.setTimeout(120_000);

let db: PrismaClient;
let ledger: Ledger;
let hierarchy: Hierarchy;
let players: Players;
let w: Withdrawals;

beforeAll(async () => {
  db = testPrisma();
  ledger = new Ledger(db);
  hierarchy = new Hierarchy(db, ledger);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
  w = new Withdrawals(db, ledger, PHONE_KEY_PAIR);
  await setFlag(db, WITHDRAWALS_FLAG, true, "test");
});
afterAll(async () => {
  await setFlag(db, WITHDRAWALS_FLAG, false, "test");
  expect(await ledger.checkInvariants()).toMatchObject({
    sumOfBalances: 0n,
    negativeViolations: [],
    ok: true,
  });
  expect(await ledger.reconcile()).toEqual([]);
  await db.$disconnect();
});

const owner: Principal = { kind: "staff", staffId: 1n, roles: ["owner"] };
const support: Principal = { kind: "staff", staffId: 2n, roles: ["support"] };
let n = 0;
let ph = 0;
let refSeq = 0;
const ref = () => `TB${process.pid}R${++refSeq}`;

async function acc(type: "AGENT_CASH_POSITION" | "PLAYER_WALLET" | "PLAYER_HELD", ownerId: bigint) {
  const ownerKind = type === "AGENT_CASH_POSITION" ? "agent" : "player";
  return (await ledger.openAccount({ type, ownerKind, ownerId: ownerId.toString() })).id;
}

/** Agent A with a member, and player P of A who deposited `walletEtb` (as a confirmed deposit would). */
async function setup(walletSantim = 50_000n) {
  n += 1;
  const agent = await hierarchy.createAgent({ slug: `wd-${process.pid}-${n}`, displayName: `A${n}` });
  const m = await db.agentMember.create({ data: { agentId: agent.id, displayName: "m" } });
  const member: Principal = { kind: "agent_member", memberId: m.id, agentId: agent.id };
  const player = await players.register({
    phone: `+25195${String(1_000_000 + ++ph).slice(-7)}`,
    referralSlug: agent.slug,
  });
  const me: Principal = { kind: "player", playerId: player.id };
  if (walletSantim > 0n) {
    await ledger.post({
      idempotencyKey: `fund-${agent.id}-${player.id}`,
      reason: "deposit",
      entries: [
        {
          debitAccountId: await acc("AGENT_CASH_POSITION", agent.id),
          creditAccountId: await acc("PLAYER_WALLET", player.id),
          amount: walletSantim,
        },
      ],
    });
  }
  const bal = async () => [
    await ledger.getBalance(await acc("AGENT_CASH_POSITION", agent.id)),
    await ledger.getBalance(await acc("PLAYER_WALLET", player.id)),
    await ledger.getBalance(await acc("PLAYER_HELD", player.id)),
  ];
  return { agent, member, player, me, bal };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof WithdrawalError ? e.code : String(e)),
  );

describe("plan 06 §6 worked example", () => {
  it("matches the table step by step", async () => {
    const { member, player, me, bal } = await setup(50_000n);
    expect(await bal()).toEqual([-50_000n, 50_000n, 0n]); // A holds 500 ETB, P has 500

    // 1. P requests 200: wallet 300, held 200.
    const r1 = await w.request(player.id, { amount: "200", method: "telebirr" });
    expect(r1.status).toBe("requested");
    expect(await bal()).toEqual([-50_000n, 30_000n, 20_000n]);

    // 2. 400 more: refused, only 300 left.
    expect(await code(w.request(player.id, { amount: "400", method: "telebirr" }))).toBe(
      "INSUFFICIENT_FUNDS",
    );
    expect(await bal()).toEqual([-50_000n, 30_000n, 20_000n]);

    // 3. A pays in Telebirr and marks it paid: no ledger move.
    const reference = ref();
    expect((await w.markPaid(member, r1.id, reference)).status).toBe("paid");
    expect(await bal()).toEqual([-50_000n, 30_000n, 20_000n]);
    expect((await w.markPaid(member, r1.id, reference.toLowerCase())).status).toBe("paid"); // same ref again

    // 4. P confirms received: held 0, A cash −30,000.
    expect((await w.received(me, r1.id)).status).toBe("completed");
    expect(await bal()).toEqual([-30_000n, 30_000n, 0n]);

    // 5. Request 100 and cancel: back to the wallet.
    const r2 = await w.request(player.id, { amount: 100, method: "ebirr" });
    expect(await bal()).toEqual([-30_000n, 20_000n, 10_000n]);
    expect((await w.cancel(me, r2.id)).status).toBe("cancelled");
    expect(await bal()).toEqual([-30_000n, 30_000n, 0n]);

    const actions = (
      await db.auditLog.findMany({
        where: { target: { in: [`withdrawal:${r1.id}`, `withdrawal:${r2.id}`] } },
        orderBy: { id: "asc" },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "withdrawal.requested",
      "withdrawal.paid",
      "withdrawal.completed",
      "withdrawal.requested",
      "withdrawal.cancelled",
    ]);
  });

  it("Q-06b: a withdrawal bigger than the agent's cash pushes the cash position above zero", async () => {
    const { agent, member, player, me, bal } = await setup(80_000n);
    // P deposited 800 and withdraws all 800: the agent holds no platform cash afterwards.
    const r = await w.request(player.id, { amount: "800", method: "telebirr" });
    await w.markPaid(member, r.id, ref());
    await w.received(me, r.id);
    expect(await bal()).toEqual([0n, 0n, 0n]);
    // Another player of the same agent with money from elsewhere (company float): A holds no cash for them.
    const other = await players.register({
      phone: `+25195${String(1_000_000 + ++ph).slice(-7)}`,
      referralSlug: agent.slug,
    });
    // A test float, not the real seeded company account (other tests check that one stays at 0).
    const float = await ledger.openAccount({
      type: "COMPANY_FLOAT",
      ownerKind: "company",
      ownerId: `test-float-${process.pid}`,
    });
    await ledger.post({
      idempotencyKey: `win-${other.id}`,
      reason: "win",
      entries: [
        { debitAccountId: float.id, creditAccountId: await acc("PLAYER_WALLET", other.id), amount: 20_000n },
      ],
    });
    const r2 = await w.request(other.id, { amount: "200", method: "telebirr" });
    await w.markPaid(member, r2.id, ref());
    await w.received({ kind: "player", playerId: other.id }, r2.id);
    // The agent paid 200 of their own money: the platform owes them 200 (+20,000).
    expect(await ledger.getBalance(await acc("AGENT_CASH_POSITION", agent.id))).toBe(20_000n);
  });
});

describe("requesting", () => {
  it("enforces 50 – 100,000 ETB, the amount format and the method", async () => {
    const { player } = await setup(20_000_000n);
    const req = (amount: unknown, method: unknown = "telebirr") =>
      code(w.request(player.id, { amount, method }));
    expect(await req("49.99")).toBe("AMOUNT_OUT_OF_RANGE");
    expect(await req("50")).toBe("ok");
    expect(await req("100000")).toBe("ok");
    expect(await req("100000.01")).toBe("AMOUNT_OUT_OF_RANGE");
    expect(await req("abc")).toBe("INVALID_INPUT");
    expect(await req("60", "paypal")).toBe("INVALID_INPUT");
  });

  it("refuses frozen players, unknown players, paused agents and a closed flag", async () => {
    const { agent, player } = await setup();
    await db.player.update({ where: { id: player.id }, data: { status: "frozen" } });
    expect(await code(w.request(player.id, { amount: "60", method: "telebirr" }))).toBe("PLAYER_NOT_ALLOWED");
    expect(await code(w.request(999_999_999n, { amount: "60", method: "telebirr" }))).toBe(
      "PLAYER_NOT_ALLOWED",
    );
    await db.player.update({ where: { id: player.id }, data: { status: "active" } });
    await db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
    expect(await code(w.request(player.id, { amount: "60", method: "telebirr" }))).toBe("AGENT_NOT_ACTIVE");
    await setFlag(db, WITHDRAWALS_FLAG, false, "test");
    try {
      expect(await code(w.request(player.id, { amount: "60", method: "telebirr" }))).toBe("CLOSED");
    } finally {
      await setFlag(db, WITHDRAWALS_FLAG, true, "test");
    }
  });

  it("two requests at once for more than the balance: one is refused", async () => {
    const { player, bal } = await setup(50_000n);
    const results = await Promise.all([
      code(w.request(player.id, { amount: "300", method: "telebirr" })),
      code(w.request(player.id, { amount: "300", method: "telebirr" })),
    ]);
    expect(results.sort()).toEqual(["INSUFFICIENT_FUNDS", "ok"]);
    expect((await bal()).slice(1)).toEqual([20_000n, 30_000n]);
  });

  it("shows the player where the money goes (verified phone, masked) and a masked reference", async () => {
    const { member, player } = await setup();
    const r = await w.request(player.id, { amount: "60", method: "telebirr" });
    await w.markPaid(member, r.id, "PAYREF123456");
    const [mine] = await w.listForPlayer(player.id);
    expect(mine).toMatchObject({ status: "paid", paidReference: "****3456", amountEtb: "60.00" });
    expect(mine?.destination).toMatch(/^\+251\*\*\*\*\d{4}$/);
    const queue = await w.queue(member, "paid");
    expect(queue.find((q) => q.id === r.id.toString())).toMatchObject({ paidReference: "PAYREF123456" });
    expect(queue.find((q) => q.id === r.id.toString())?.payTo).toMatch(/^\+2519\d{8}$/);
    expect(await w.listForPlayer(999_999_999n)).toEqual([]);
  });
});

describe("agent and staff actions", () => {
  it("decline returns the money; a reason is required", async () => {
    const { member, player, bal } = await setup(50_000n);
    const r = await w.request(player.id, { amount: "100", method: "telebirr" });
    expect(await code(w.decline(member, r.id, " "))).toBe("INVALID_INPUT");
    expect(await code(w.decline(member, r.id, 42))).toBe("INVALID_INPUT");
    expect((await w.decline(member, r.id, "wrong number")).status).toBe("declined");
    expect(await bal()).toEqual([-50_000n, 50_000n, 0n]);
  });

  it("one payment reference can't prove two withdrawals; a different reference on a paid one is refused", async () => {
    const { member, player } = await setup(50_000n);
    const a = await w.request(player.id, { amount: "60", method: "telebirr" });
    const b = await w.request(player.id, { amount: "60", method: "telebirr" });
    const shared = ref();
    await w.markPaid(member, a.id, shared);
    expect(await code(w.markPaid(member, b.id, shared))).toBe("DUPLICATE_REFERENCE");
    expect(await code(w.markPaid(member, a.id, ref()))).toBe("WRONG_STATE");
    expect(await code(w.markPaid(member, b.id, "!"))).toBe("INVALID_INPUT");
  });

  it("scopes: other agents and players can't touch it; support staff can't; the owner can", async () => {
    const a = await setup(50_000n);
    const b = await setup(50_000n);
    const r = await w.request(a.player.id, { amount: "60", method: "telebirr" });
    expect(await code(w.markPaid(b.member, r.id, ref()))).toBe("NOT_FOUND");
    expect(await code(w.cancel(b.me, r.id))).toBe("NOT_FOUND");
    expect(await code(w.cancel(a.member, r.id))).toBe("FORBIDDEN");
    expect(await code(w.markPaid(support, r.id, ref()))).toBe("FORBIDDEN");
    expect(await code(w.complete(a.member, r.id))).toBe("FORBIDDEN");
    expect(await code(w.queue(support, undefined))).toBe("FORBIDDEN");
    expect(await code(w.queue(a.me, undefined))).toBe("FORBIDDEN");
    expect((await w.queue(b.member, "requested")).map((q) => q.id)).not.toContain(r.id.toString());
    expect((await w.queue(owner, "")).map((q) => q.id)).toContain(r.id.toString());

    expect((await w.markPaid(owner, r.id, ref())).status).toBe("paid");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { target: `withdrawal:${r.id}`, action: { startsWith: "withdrawal.paid" } },
    });
    expect(audit.action).toBe("withdrawal.paid.override");
    expect(await code(w.received(a.me, 999_999_999n))).toBe("NOT_FOUND");
  });

  it("disputes go to the owner, who completes or cancels", async () => {
    const one = await setup(50_000n);
    const r = await w.request(one.player.id, { amount: "100", method: "telebirr" });
    await w.markPaid(one.member, r.id, ref());
    expect(await code(w.cancel(one.me, r.id))).toBe("WRONG_STATE"); // money may be on its way
    expect((await w.notReceived(one.me, r.id)).status).toBe("disputed");
    expect(await code(w.staffCancel(owner, r.id, ""))).toBe("INVALID_INPUT");
    expect((await w.staffCancel(owner, r.id, "agent couldn't prove payment")).status).toBe("cancelled");
    expect(await one.bal()).toEqual([-50_000n, 50_000n, 0n]);

    const two = await setup(50_000n);
    const r2 = await w.request(two.player.id, { amount: "100", method: "telebirr" });
    await w.markPaid(two.member, r2.id, ref());
    await w.notReceived(two.me, r2.id);
    expect((await w.complete(owner, r2.id)).status).toBe("completed");
    expect(await two.bal()).toEqual([-40_000n, 40_000n, 0n]);
    expect(await code(w.complete(owner, r2.id))).toBe("WRONG_STATE");
  });

  it("20 parallel 'received' make exactly one final posting", async () => {
    const { member, player, me, bal } = await setup(50_000n);
    const r = await w.request(player.id, { amount: "100", method: "telebirr" });
    await w.markPaid(member, r.id, ref());
    const results = await Promise.all(Array.from({ length: 20 }, () => code(w.received(me, r.id))));
    expect(results.filter((x) => x === "ok")).toHaveLength(1);
    expect(results.filter((x) => x === "WRONG_STATE")).toHaveLength(19);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `withdrawal:${r.id}:final` } })).toBe(
      1,
    );
    expect(await bal()).toEqual([-40_000n, 40_000n, 0n]);
  });

  it("paid vs cancel at the same moment: exactly one wins", async () => {
    const { member, player, me } = await setup(50_000n);
    const r = await w.request(player.id, { amount: "100", method: "telebirr" });
    const results = await Promise.all([code(w.markPaid(member, r.id, ref())), code(w.cancel(me, r.id))]);
    expect(results.sort()).toEqual(["WRONG_STATE", "ok"]);
  });
});

describe("SLA", () => {
  it("escalates unpaid after 24 h, auto-completes paid after 24 h, leaves the rest", async () => {
    const { member, player, bal } = await setup(50_000n);
    const late = await w.request(player.id, { amount: "60", method: "telebirr" });
    const fresh = await w.request(player.id, { amount: "60", method: "telebirr" });
    const paid = await w.request(player.id, { amount: "60", method: "telebirr" });
    await w.markPaid(member, paid.id, ref());
    const in25h = new Date(Date.now() + 25 * 3_600_000);
    // Only `late` and `paid` are made old: move `fresh`'s deadline out of reach.
    await db.$executeRaw`ALTER TABLE withdrawals DISABLE TRIGGER withdrawals_status_moves`;
    await db.$executeRaw`UPDATE withdrawals SET sla_due_at = now() + interval '48 hours' WHERE id = ${fresh.id}`;
    await db.$executeRaw`ALTER TABLE withdrawals ENABLE TRIGGER withdrawals_status_moves`;

    const result = await w.runSla(in25h);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    expect(result.completed).toBeGreaterThanOrEqual(1);
    const status = async (id: bigint) => (await db.withdrawal.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(late.id)).toBe("escalated");
    expect(await status(fresh.id)).toBe("requested");
    expect(await status(paid.id)).toBe("completed");
    expect(await bal()).toEqual([-44_000n, 32_000n, 12_000n]);

    // Escalated: the agent can still pay it, then the owner completes.
    await w.markPaid(member, late.id, ref());
    expect(await w.runSla(new Date())).toEqual({ escalated: 0, completed: 0 });
  });

  it("does nothing when the auto-complete window isn't configured", async () => {
    const fake = {
      withdrawal: { updateMany: async () => ({ count: 0 }) },
      configVersion: { findFirst: async () => null },
    } as unknown as PrismaClient;
    expect(await new Withdrawals(fake, ledger, PHONE_KEY_PAIR).runSla()).toEqual({
      escalated: 0,
      completed: 0,
    });
    const notConfigured = {
      featureFlag: { findUnique: async () => ({ enabled: true }) },
      configVersion: { findFirst: async () => null },
    } as unknown as PrismaClient;
    expect(await code(new Withdrawals(notConfigured, ledger, PHONE_KEY_PAIR).request(1n, {}))).toBe(
      "NOT_CONFIGURED",
    );
  });

  it("skips a paid withdrawal that was resolved between the scan and the lock", async () => {
    const { member, player, me } = await setup(50_000n);
    const r = await w.request(player.id, { amount: "60", method: "telebirr" });
    await w.markPaid(member, r.id, ref());
    // Scan sees it as paid; by the time it's locked the player has confirmed.
    const realFindMany = db.withdrawal.findMany.bind(db.withdrawal);
    const racing = new Proxy(db, {
      get: (t, p) =>
        p === "withdrawal"
          ? new Proxy(t.withdrawal, {
              get: (wt, wp) =>
                wp === "findMany"
                  ? async (args: Parameters<typeof realFindMany>[0]) => {
                      const rows = await realFindMany(args);
                      await w.received(me, r.id);
                      return rows.filter((x) => x.id === r.id);
                    }
                  : Reflect.get(wt, wp),
            })
          : Reflect.get(t, p),
    });
    const result = await new Withdrawals(racing, ledger, PHONE_KEY_PAIR).runSla(
      new Date(Date.now() + 25 * 3_600_000),
    );
    expect(result.completed).toBe(0);
  });
});

describe("the database guards the status moves", () => {
  it("refuses forbidden moves, edits of the request, and deleting", async () => {
    const { member, player } = await setup(50_000n);
    const r = await w.request(player.id, { amount: "60", method: "telebirr" });
    const set = (data: object) => db.withdrawal.update({ where: { id: r.id }, data });
    await expect(set({ status: "completed" })).rejects.toThrow(/can't go from requested to completed/);
    await expect(set({ amount: 1n })).rejects.toThrow(/immutable/);
    await expect(set({ status: "paid" })).rejects.toThrow(/needs its payment reference/);
    await expect(set({ status: "cancelled" })).rejects.toThrow(/closing ledger posting/);
    await w.decline(member, r.id, "no");
    await expect(set({ status: "requested" })).rejects.toThrow(/can't go from declined/);
    await expect(db.withdrawal.delete({ where: { id: r.id } })).rejects.toThrow(/never deleted/);
  });
});

describe("unexpected errors", () => {
  it("are passed through unchanged", async () => {
    const { player } = await setup();
    const sabotaged = new Proxy(db, {
      get: (t, p) => (p === "$transaction" ? () => Promise.reject(new Error("db down")) : Reflect.get(t, p)),
    });
    expect(
      await code(
        new Withdrawals(sabotaged, ledger, PHONE_KEY_PAIR).request(player.id, {
          amount: "60",
          method: "telebirr",
        }),
      ),
    ).toMatch(/db down/);
    const { member, player: p2 } = await setup(50_000n);
    const r = await w.request(p2.id, { amount: "60", method: "telebirr" });
    expect(
      await code(new Withdrawals(sabotaged, ledger, PHONE_KEY_PAIR).markPaid(member, r.id, ref())),
    ).toMatch(/db down/);
  });
});
