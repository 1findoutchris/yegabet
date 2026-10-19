import type { PrismaClient } from "@prisma/client";
import type { Principal } from "../../src/auth/rbac";
import { setFlag } from "../../src/config/featureFlags";
import { DEPOSITS_FLAG, DepositError, Deposits } from "../../src/deposits/deposits";
import { Ledger } from "../../src/ledger/ledger";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

jest.setTimeout(120_000);

let db: PrismaClient;
let ledger: Ledger;
let hierarchy: Hierarchy;
let players: Players;
let deposits: Deposits;

beforeAll(async () => {
  db = testPrisma();
  ledger = new Ledger(db);
  hierarchy = new Hierarchy(db, ledger);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
  deposits = new Deposits(db, ledger, PHONE_KEY_PAIR);
  await setFlag(db, DEPOSITS_FLAG, true, "test");
});
afterAll(async () => {
  await setFlag(db, DEPOSITS_FLAG, false, "test");
  const report = await ledger.checkInvariants();
  expect(report).toMatchObject({ sumOfBalances: 0n, ok: true });
  expect(await ledger.reconcile()).toEqual([]);
  await db.$disconnect();
});

let n = 0;
let phoneSeq = 0;
const owner: Principal = { kind: "staff", staffId: 1n, roles: ["owner"] };
const support: Principal = { kind: "staff", staffId: 2n, roles: ["support"] };

/** An agent with one member and one Telebirr account, plus a player of theirs. */
async function setup() {
  n += 1;
  const agent = await hierarchy.createAgent({ slug: `dep-${process.pid}-${n}`, displayName: `Agent ${n}` });
  const m = await db.agentMember.create({ data: { agentId: agent.id, displayName: "member" } });
  const member: Principal = { kind: "agent_member", memberId: m.id, agentId: agent.id };
  const account = await deposits.addPaymentAccount(member, {
    method: "telebirr",
    accountName: `Agent ${n}`,
    accountNumber: `0911${String(100_000 + n).slice(-6)}`,
  });
  const player = await players.register({
    phone: `+25193${String(1_000_000 + ++phoneSeq).slice(-7)}`,
    referralSlug: agent.slug,
  });
  return { agent, member, account, player };
}

async function balanceOf(type: "AGENT_CASH_POSITION" | "PLAYER_WALLET", ownerId: bigint): Promise<bigint> {
  const kind = type === "PLAYER_WALLET" ? "player" : "agent";
  const acc = await db.account.findFirstOrThrow({
    where: { type, ownerKind: kind, ownerId: ownerId.toString() },
  });
  return ledger.getBalance(acc.id);
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof DepositError ? e.code : String(e)),
  );

describe("plan 05 §6 worked example", () => {
  it("matches the table step by step", async () => {
    const { agent, member, account, player } = await setup();
    const balances = async () => [
      await balanceOf("AGENT_CASH_POSITION", agent.id),
      await balanceOf("PLAYER_WALLET", player.id),
    ];
    const ref = `CHK${process.pid}${n}`;

    // 1. Submit 500.00 ETB: pending, nothing moves.
    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "500",
      reference: ref,
    });
    expect(d).toMatchObject({ status: "pending", amount: 50_000n, agentId: agent.id, method: "telebirr" });
    expect(await balances()).toEqual([0n, 0n]);

    // 2. The agent confirms: cash −50,000, wallet +50,000.
    const confirmed = await deposits.decide(member, d.id, "confirm", undefined);
    expect(confirmed.status).toBe("confirmed");
    expect(await balances()).toEqual([-50_000n, 50_000n]);

    // 3. Double tap: same result, still one posting.
    expect((await deposits.decide(member, d.id, "confirm", undefined)).status).toBe("confirmed");
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `deposit:${d.id}` } })).toBe(1);
    expect(await balances()).toEqual([-50_000n, 50_000n]);

    // 4. Same reference, different spelling, another player: refused.
    const other = await players.register({
      phone: `+25193${String(1_000_000 + ++phoneSeq).slice(-7)}`,
      referralSlug: agent.slug,
    });
    const spaced = `${ref.slice(0, 3).toLowerCase()} ${ref.slice(3)}`;
    expect(
      await code(
        deposits.submit(other.id, {
          paymentAccountId: account.id.toString(),
          amount: "100",
          reference: spaced,
        }),
      ),
    ).toBe("DUPLICATE_REFERENCE");

    // 5. A 200.00 deposit is rejected: nothing moves.
    const d2 = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "200.00",
      reference: `${ref}B`,
    });
    expect((await deposits.decide(member, d2.id, "reject", "no such payment")).status).toBe("rejected");
    expect(await balances()).toEqual([-50_000n, 50_000n]);

    // Every step is in the audit log.
    const actions = (
      await db.auditLog.findMany({
        where: { target: { in: [`deposit:${d.id}`, `deposit:${d2.id}`] } },
        orderBy: { id: "asc" },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "deposit.submitted",
      "deposit.confirmed",
      "deposit.submitted",
      "deposit.rejected",
    ]);
  });
});

describe("submitting", () => {
  it("enforces the 15 – 100,000 ETB limits and the amount format", async () => {
    const { account, player } = await setup();
    let i = 0;
    const submit = (amount: unknown) =>
      code(
        deposits.submit(player.id, {
          paymentAccountId: account.id.toString(),
          amount,
          reference: `LIM${n}X${++i}`,
        }),
      );
    expect(await submit("14.99")).toBe("AMOUNT_OUT_OF_RANGE");
    expect(await submit("15")).toBe("ok");
    expect(await submit(100_000)).toBe("ok");
    expect(await submit("100000.01")).toBe("AMOUNT_OUT_OF_RANGE");
    for (const bad of ["1,000", "abc", "12.345", 12.5, -20, "", null])
      expect(await submit(bad)).toBe("INVALID_INPUT");
  });

  it("refuses bad references, a reused reference even after rejection, but allows it on another method", async () => {
    const { member, account, player } = await setup();
    const submit = (reference: unknown, accountId = account.id) =>
      code(deposits.submit(player.id, { paymentAccountId: accountId.toString(), amount: "50", reference }));
    expect(await submit("ab")).toBe("INVALID_INPUT");
    expect(await submit("bad!ref")).toBe("INVALID_INPUT");
    expect(await submit(12345)).toBe("INVALID_INPUT");

    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "50",
      reference: `REUSE${n}`,
    });
    await deposits.decide(member, d.id, "reject", "fake");
    expect(await submit(`reuse${n}`)).toBe("DUPLICATE_REFERENCE");

    const cbe = await deposits.addPaymentAccount(member, {
      method: "cbe_birr",
      accountName: "CBE",
      accountNumber: `0922${n}00001`,
    });
    expect(await submit(`REUSE${n}`, cbe.id)).toBe("ok");
  });

  it("only into an active account of the player's own agent", async () => {
    const a = await setup();
    const b = await setup();
    const submit = (paymentAccountId: unknown) =>
      code(
        deposits.submit(a.player.id, {
          paymentAccountId,
          amount: "50",
          reference: `ACC${n}${Math.random()}`.replace(/\D/g, "9"),
        }),
      );
    expect(await submit(b.account.id.toString())).toBe("ACCOUNT_NOT_AVAILABLE");
    expect(await submit("999999999")).toBe("ACCOUNT_NOT_AVAILABLE");
    expect(await submit(12)).toBe("ACCOUNT_NOT_AVAILABLE");
    expect(await submit("abc")).toBe("ACCOUNT_NOT_AVAILABLE");
    await deposits.deactivatePaymentAccount(a.member, a.account.id);
    expect(await submit(a.account.id.toString())).toBe("ACCOUNT_NOT_AVAILABLE");
    expect(await deposits.accountsForPlayer(a.player.id)).toEqual([]);
  });

  it("refuses a frozen or self-excluded player, an unknown player, and a paused agent", async () => {
    const { agent, account, player } = await setup();
    const submit = () =>
      code(
        deposits.submit(player.id, {
          paymentAccountId: account.id.toString(),
          amount: "50",
          reference: `ST${n}X1`,
        }),
      );
    await db.player.update({ where: { id: player.id }, data: { status: "self_excluded" } });
    expect(await submit()).toBe("PLAYER_NOT_ALLOWED");
    await db.player.update({ where: { id: player.id }, data: { status: "active" } });
    await db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
    expect(await submit()).toBe("AGENT_NOT_ACTIVE");
    expect(await code(deposits.accountsForPlayer(999_999_999n))).toBe("PLAYER_NOT_ALLOWED");
  });

  it("is closed while the flag is off", async () => {
    const { account, player } = await setup();
    await setFlag(db, DEPOSITS_FLAG, false, "test");
    try {
      expect(
        await code(
          deposits.submit(player.id, {
            paymentAccountId: account.id.toString(),
            amount: "50",
            reference: `CL${n}X1`,
          }),
        ),
      ).toBe("CLOSED");
    } finally {
      await setFlag(db, DEPOSITS_FLAG, true, "test");
    }
  });

  it("shows players a masked reference and agents the full one", async () => {
    const { member, account, player } = await setup();
    await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "75.5",
      reference: `VIEW${n}9876`,
    });
    const mine = await deposits.listForPlayer(player.id);
    expect(mine[0]).toMatchObject({
      reference: "****9876",
      amountEtb: "75.50",
      amountSantim: "7550",
      status: "pending",
    });
    const queue = await deposits.queue(member, "pending");
    expect(queue.find((q) => q.amountSantim === "7550")?.reference).toBe(`VIEW${n}9876`);
    // The reference is never stored in plain text.
    const row = await db.deposit.findFirstOrThrow({ where: { playerId: player.id } });
    expect(JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain(
      `VIEW${n}9876`,
    );
  });
});

describe("deciding", () => {
  it("20 parallel confirms make exactly one posting", async () => {
    const { agent, member, account, player } = await setup();
    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "1000",
      reference: `PAR${n}X1`,
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => code(deposits.decide(member, d.id, "confirm", undefined))),
    );
    expect(results.every((r) => r === "ok")).toBe(true);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: `deposit:${d.id}` } })).toBe(1);
    expect(await balanceOf("AGENT_CASH_POSITION", agent.id)).toBe(-100_000n);
  });

  it("confirm vs reject at the same moment: exactly one wins", async () => {
    const { member, account, player } = await setup();
    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "30",
      reference: `RACE${n}X1`,
    });
    const [c, r] = await Promise.all([
      code(deposits.decide(member, d.id, "confirm", undefined)),
      code(deposits.decide(member, d.id, "reject", "duplicate")),
    ]);
    expect([c, r].sort()).toEqual(["ALREADY_DECIDED", "ok"]);
    const final = await db.deposit.findUniqueOrThrow({ where: { id: d.id } });
    const posted = await db.ledgerTransaction.count({ where: { idempotencyKey: `deposit:${d.id}` } });
    expect(posted).toBe(final.status === "confirmed" ? 1 : 0);
  });

  it("agents only see and decide their own; the owner can override anything; others can't", async () => {
    const a = await setup();
    const b = await setup();
    const d = await deposits.submit(a.player.id, {
      paymentAccountId: a.account.id.toString(),
      amount: "40",
      reference: `SCOPE${n}X1`,
    });
    expect(await code(deposits.decide(b.member, d.id, "confirm", undefined))).toBe("NOT_FOUND");
    expect((await deposits.queue(b.member, "pending")).map((q) => q.id)).not.toContain(d.id.toString());
    expect(await code(deposits.decide(support, d.id, "confirm", undefined))).toBe("FORBIDDEN");
    expect(
      await code(deposits.decide({ kind: "player", playerId: a.player.id }, d.id, "confirm", undefined)),
    ).toBe("FORBIDDEN");
    expect(await code(deposits.queue(support, undefined))).toBe("FORBIDDEN");

    expect((await deposits.queue(owner, "")).map((q) => q.id)).toContain(d.id.toString());
    expect((await deposits.decide(owner, d.id, "confirm", undefined)).status).toBe("confirmed");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { target: `deposit:${d.id}`, action: { startsWith: "deposit.confirmed" } },
    });
    expect(audit).toMatchObject({ action: "deposit.confirmed.override", actorKind: "staff" });
  });

  it("rejecting needs a reason; a decided deposit can't change its mind; unknown ids aren't found", async () => {
    const { member, account, player } = await setup();
    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "20",
      reference: `REJ${n}X1`,
    });
    expect(await code(deposits.decide(member, d.id, "reject", "  "))).toBe("INVALID_INPUT");
    expect(await code(deposits.decide(member, d.id, "reject", 42))).toBe("INVALID_INPUT");
    expect((await deposits.decide(member, d.id, "reject", "not received")).status).toBe("rejected");
    expect((await deposits.decide(member, d.id, "reject", "again")).status).toBe("rejected");
    expect(await code(deposits.decide(member, d.id, "confirm", undefined))).toBe("ALREADY_DECIDED");
    expect(await code(deposits.decide(member, 999_999_999n, "confirm", undefined))).toBe("NOT_FOUND");
  });
});

describe("expiry (24 h)", () => {
  it("expires pending deposits older than 24 h and leaves newer ones", async () => {
    const { agent, account, player } = await setup();
    const make = (hoursAgo: number, ref: string) =>
      db.deposit.create({
        data: {
          playerId: player.id,
          agentId: agent.id,
          paymentAccountId: account.id,
          method: "telebirr",
          amount: 5000n,
          referenceHash: `${ref}-hash`,
          referenceEnc: "x",
          createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
        },
      });
    const old = await make(25, `old${n}`);
    const recent = await make(23, `new${n}`);
    expect(await deposits.expireStale()).toBeGreaterThanOrEqual(1);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("expired");
    expect((await db.deposit.findUniqueOrThrow({ where: { id: recent.id } })).status).toBe("pending");
    expect(await deposits.expireStale()).toBe(0);
  });
});

describe("the database guards a deposit's history", () => {
  it("refuses changing a request, undoing a decision, confirming without money, and deleting", async () => {
    const { member, account, player } = await setup();
    const d = await deposits.submit(player.id, {
      paymentAccountId: account.id.toString(),
      amount: "25",
      reference: `DB${n}X1`,
    });
    await expect(
      db.deposit.update({ where: { id: d.id }, data: { amount: 1n, status: "rejected" } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.deposit.update({ where: { id: d.id }, data: { decisionReason: "x" } })).rejects.toThrow(
      /only change by being decided/,
    );
    await expect(db.deposit.update({ where: { id: d.id }, data: { status: "confirmed" } })).rejects.toThrow(
      /needs its ledger transaction/,
    );
    await deposits.decide(member, d.id, "reject", "no");
    await expect(db.deposit.update({ where: { id: d.id }, data: { status: "pending" } })).rejects.toThrow(
      /already rejected/,
    );
    await expect(db.deposit.delete({ where: { id: d.id } })).rejects.toThrow(/never deleted/);
  });
});

describe("payment accounts (agents manage their own)", () => {
  it("validates, refuses duplicates and other agents, and audits", async () => {
    const a = await setup();
    const b = await setup();
    const add = (p: Principal, input: Record<string, unknown>) => code(deposits.addPaymentAccount(p, input));
    expect(await add(a.member, { method: "paypal", accountName: "X", accountNumber: "0911000000" })).toBe(
      "INVALID_INPUT",
    );
    expect(await add(a.member, { method: "ebirr", accountName: "A", accountNumber: "0911000000" })).toBe(
      "INVALID_INPUT",
    );
    expect(await add(a.member, { method: "ebirr", accountName: "Abebe", accountNumber: "12ab" })).toBe(
      "INVALID_INPUT",
    );
    expect(await add(a.member, { method: "ebirr", accountName: 5, accountNumber: 911 })).toBe(
      "INVALID_INPUT",
    );
    expect(
      await add(a.member, { method: "ebirr", accountName: "Abebe", accountNumber: "0911-22 3344" }),
    ).toBe("ok");
    expect(await add(b.member, { method: "ebirr", accountName: "Kebede", accountNumber: "0911223344" })).toBe(
      "ACCOUNT_TAKEN",
    );
    expect(await add(owner, { method: "ebirr", accountName: "Owner", accountNumber: "0911999999" })).toBe(
      "FORBIDDEN",
    );

    expect((await deposits.listOwnPaymentAccounts(a.member)).map((x) => x.method)).toEqual([
      "telebirr",
      "ebirr",
    ]);
    expect(await code(deposits.deactivatePaymentAccount(b.member, a.account.id))).toBe("NOT_FOUND");
    await deposits.deactivatePaymentAccount(a.member, a.account.id, "1.2.3.4");
    expect(await code(deposits.deactivatePaymentAccount(a.member, a.account.id))).toBe("NOT_FOUND");
    const actions = (
      await db.auditLog.findMany({ where: { target: `payment_account:${a.account.id}` } })
    ).map((x) => x.action);
    expect(actions).toEqual(["payment_account.added", "payment_account.deactivated"]);
  });
});

describe("misconfiguration", () => {
  it("refuses deposits without configured limits, and expires nothing without a TTL", async () => {
    const fake = {
      featureFlag: { findUnique: async () => ({ enabled: true }) },
      configVersion: { findFirst: async () => null },
    } as unknown as PrismaClient;
    const d = new Deposits(fake, ledger, PHONE_KEY_PAIR);
    expect(await code(d.submit(1n, {}))).toBe("NOT_CONFIGURED");
    expect(await d.expireStale()).toBe(0);
  });

  it("lets an unexpected error on submit through", async () => {
    const { account, player } = await setup();
    const sabotaged = new Proxy(db, {
      get: (t, p) =>
        p === "deposit" ? { create: () => Promise.reject(new Error("disk full")) } : Reflect.get(t, p),
    });
    const d = new Deposits(sabotaged, ledger, PHONE_KEY_PAIR);
    expect(
      await code(
        d.submit(player.id, { paymentAccountId: account.id.toString(), amount: "50", reference: "SAB12345" }),
      ),
    ).toMatch(/disk full/);
  });

  it("lets unexpected database errors through", async () => {
    const { member } = await setup();
    const broken = new Deposits(
      {
        agentPaymentAccount: { create: () => Promise.reject(new Error("db down")) },
      } as unknown as PrismaClient,
      ledger,
      PHONE_KEY_PAIR,
    );
    expect(
      await code(
        broken.addPaymentAccount(member, { method: "ebirr", accountName: "Ab", accountNumber: "0911555555" }),
      ),
    ).toMatch(/db down/);
  });
});
