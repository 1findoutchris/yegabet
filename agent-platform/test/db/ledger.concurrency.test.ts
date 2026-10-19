import type { PrismaClient } from "@prisma/client";
import { Ledger } from "../../src/ledger/ledger";
import { IdempotencyConflictError, InsufficientFundsError } from "../../src/ledger/errors";
import { etb, testPrisma, uid } from "./testDb";

let db: PrismaClient;
let ledger: Ledger;

beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db, { timeoutMs: 60_000, maxWaitMs: 60_000 });
});
afterAll(async () => {
  const report = await ledger.checkInvariants();
  expect(report).toMatchObject({ sumOfBalances: 0n, sumOfDerived: 0n, negativeViolations: [], ok: true });
  await db.$disconnect();
});

jest.setTimeout(120_000);

async function fundedWallet(amount: bigint) {
  const float = await ledger.openAccount({
    type: "COMPANY_FLOAT",
    ownerKind: "company",
    ownerId: uid("float"),
  });
  const wallet = await ledger.openAccount({ type: "PLAYER_WALLET", ownerKind: "player", ownerId: uid("p") });
  const revenue = await ledger.openAccount({
    type: "COMPANY_REVENUE",
    ownerKind: "company",
    ownerId: uid("rev"),
  });
  await ledger.post({
    idempotencyKey: uid("fund"),
    reason: "fund",
    entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount }],
  });
  return { float, wallet, revenue };
}

it("50 parallel spends of 10.00 from 100.00: exactly 10 succeed, never negative", async () => {
  const { wallet, revenue } = await fundedWallet(etb("100.00"));
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) =>
      ledger.post({
        idempotencyKey: uid(`spend-${i}`),
        reason: "bet",
        entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: etb("10.00") }],
      }),
    ),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  const refused = results.filter((r) => r.status === "rejected");
  expect(ok).toHaveLength(10);
  expect(refused).toHaveLength(40);
  for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFundsError);
  expect(await ledger.getBalance(wallet.id)).toBe(0n);
  expect(await ledger.getBalance(revenue.id)).toBe(etb("100.00"));
  expect(await ledger.getDerivedBalance(wallet.id)).toBe(0n);
});

it("20 parallel posts with one key: exactly one transaction, identical results", async () => {
  const { wallet, revenue } = await fundedWallet(etb("50.00"));
  const key = uid("same");
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      ledger.post({
        idempotencyKey: key,
        reason: "bet",
        entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: etb("5.00") }],
      }),
    ),
  );
  expect(new Set(results.map((r) => r.transaction.id)).size).toBe(1);
  expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(1);
  expect(await ledger.getBalance(wallet.id)).toBe(etb("45.00"));
});

it("one key raced with two different requests on unrelated accounts: one wins, the other conflicts", async () => {
  const a = await fundedWallet(etb("10.00"));
  const b = await fundedWallet(etb("10.00"));
  const key = uid("race");
  const results = await Promise.allSettled(
    [a, b].map((w) =>
      ledger.post({
        idempotencyKey: key,
        reason: "bet",
        entries: [{ debitAccountId: w.wallet.id, creditAccountId: w.revenue.id, amount: 100n }],
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(IdempotencyConflictError);
  const total = (await ledger.getBalance(a.wallet.id)) + (await ledger.getBalance(b.wallet.id));
  expect(total).toBe(etb("20.00") - 100n);
});

it("30 parallel opposite-direction transfers between two wallets: no deadlock, nothing lost", async () => {
  const x = await fundedWallet(etb("1000.00"));
  const y = await fundedWallet(etb("1000.00"));
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => {
      const [from, to] = i % 2 === 0 ? [x.wallet, y.wallet] : [y.wallet, x.wallet];
      return ledger.post({
        idempotencyKey: uid(`swap-${i}`),
        reason: "transfer",
        entries: [{ debitAccountId: from.id, creditAccountId: to.id, amount: etb("7.00") }],
      });
    }),
  );
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  // 15 each way cancel out.
  expect(await ledger.getBalance(x.wallet.id)).toBe(etb("1000.00"));
  expect(await ledger.getBalance(y.wallet.id)).toBe(etb("1000.00"));
});
