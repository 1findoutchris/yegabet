import type { PrismaClient } from "@prisma/client";
import { Ledger, type Account } from "../../src/ledger/ledger";
import {
  AccountNotFoundError,
  AlreadyReversedError,
  CurrencyMismatchError,
  IdempotencyConflictError,
  InsufficientFundsError,
  TransactionNotFoundError,
  ValidationError,
} from "../../src/ledger/errors";
import type { AccountType, OwnerKind } from "../../src/ledger/accountTypes";
import { etb, testPrisma, uid } from "./testDb";

let db: PrismaClient;
let ledger: Ledger;

beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db);
});
afterAll(async () => {
  await ledger.checkInvariants().then((r) => expect(r.ok).toBe(true));
  await db.$disconnect();
});

const open = (type: AccountType, ownerKind: OwnerKind = "player"): Promise<Account> =>
  ledger.openAccount({ type, ownerKind, ownerId: uid(type) });

async function balances(...accounts: Account[]): Promise<bigint[]> {
  return Promise.all(accounts.map((a) => ledger.getBalance(a.id)));
}

describe("plan 02 §6 worked example", () => {
  it("matches the table step by step", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const revenue = await open("COMPANY_REVENUE", "company");

    // 0: open accounts
    expect(await balances(float, wallet, revenue)).toEqual([0n, 0n, 0n]);

    // 1: FLOAT → WALLET 100.00 ETB
    const t1 = await ledger.post({
      idempotencyKey: uid("t1"),
      reason: "example",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: etb("100.00") }],
    });
    expect(t1.replayed).toBe(false);
    expect(await balances(float, wallet, revenue)).toEqual([-10_000n, 10_000n, 0n]);

    // 2: WALLET → REVENUE 25.50 ETB
    const t2req = {
      idempotencyKey: uid("t2"),
      reason: "example",
      referenceId: "ref-t2",
      entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: etb("25.50") }],
    };
    const t2 = await ledger.post(t2req);
    expect(await balances(float, wallet, revenue)).toEqual([-10_000n, 7_450n, 2_550n]);

    // 3: same key, same request: replayed, nothing written
    const again = await ledger.post(t2req);
    expect(again.replayed).toBe(true);
    expect(again.transaction.id).toBe(t2.transaction.id);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: t2req.idempotencyKey } })).toBe(1);
    expect(await balances(float, wallet, revenue)).toEqual([-10_000n, 7_450n, 2_550n]);

    // 4: WALLET → REVENUE 80.00 ETB: refused, nothing written
    await expect(
      ledger.post({
        idempotencyKey: uid("t3"),
        reason: "example",
        entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: etb("80.00") }],
      }),
    ).rejects.toThrow(InsufficientFundsError);
    expect(await balances(float, wallet, revenue)).toEqual([-10_000n, 7_450n, 2_550n]);

    // 5: reverse t2
    const r2 = await ledger.reverse({
      transactionId: t2.transaction.id,
      idempotencyKey: uid("r2"),
      reason: "undo",
    });
    expect(r2.transaction.reversesTransactionId).toBe(t2.transaction.id);
    expect(r2.transaction.referenceId).toBe("ref-t2");
    expect(r2.transaction.entries).toEqual([
      { debitAccountId: revenue.id, creditAccountId: wallet.id, amount: 2_550n, currency: "ETB" },
    ]);
    expect(await balances(float, wallet, revenue)).toEqual([-10_000n, 10_000n, 0n]);

    // 6: reverse t2 again with a new key: refused
    await expect(
      ledger.reverse({ transactionId: t2.transaction.id, idempotencyKey: uid("r2b"), reason: "undo" }),
    ).rejects.toThrow(AlreadyReversedError);

    // Σ = 0 and the cache matches the entries for all three
    for (const a of [float, wallet, revenue]) {
      expect(await ledger.getDerivedBalance(a.id)).toBe(await ledger.getBalance(a.id));
    }
  });
});

describe("posting", () => {
  it("stores every §5.1 field on the entry row", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const key = uid("fields");
    const { transaction } = await ledger.post({
      idempotencyKey: key,
      reason: "deposit",
      referenceId: "dep-9",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 1n }],
    });
    const row = await db.ledgerEntry.findFirstOrThrow({ where: { transactionId: transaction.id } });
    expect(row).toMatchObject({
      debitAccountId: float.id,
      creditAccountId: wallet.id,
      amount: 1n,
      currency: "ETB",
      reason: "deposit",
      referenceId: "dep-9",
      idempotencyKey: `${key}#0`,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("refuses the same key with a different request and writes nothing", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const key = uid("conflict");
    await ledger.post({
      idempotencyKey: key,
      reason: "r",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 500n }],
    });
    await expect(
      ledger.post({
        idempotencyKey: key,
        reason: "r",
        entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 501n }],
      }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(await ledger.getBalance(wallet.id)).toBe(500n);
  });

  it("is all-or-nothing: one overdrawing leg refuses the whole posting", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const a = await open("PLAYER_WALLET");
    const b = await open("PLAYER_WALLET");
    await ledger.post({
      idempotencyKey: uid("fund"),
      reason: "fund",
      entries: [{ debitAccountId: float.id, creditAccountId: a.id, amount: 1_000n }],
    });
    const key = uid("multi");
    await expect(
      ledger.post({
        idempotencyKey: key,
        reason: "multi",
        entries: [
          { debitAccountId: float.id, creditAccountId: b.id, amount: 300n }, // fine alone
          { debitAccountId: a.id, creditAccountId: b.id, amount: 1_001n }, // overdraws a
        ],
      }),
    ).rejects.toMatchObject({
      name: "InsufficientFundsError",
      accountId: a.id,
      balance: 1_000n,
      change: -1_001n,
    });
    expect(await balances(a, b)).toEqual([1_000n, 0n]);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("nets legs per account: in and out of one account in one posting is fine", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const revenue = await open("COMPANY_REVENUE", "company");
    // Wallet starts at 0: +500 in, −500 out in the same posting.
    await ledger.post({
      idempotencyKey: uid("net"),
      reason: "bet_win",
      entries: [
        { debitAccountId: float.id, creditAccountId: wallet.id, amount: 500n },
        { debitAccountId: wallet.id, creditAccountId: revenue.id, amount: 500n },
      ],
    });
    expect(await balances(float, wallet, revenue)).toEqual([-500n, 0n, 500n]);
  });

  it("lets allow-negative accounts go negative", async () => {
    const cash = await open("AGENT_CASH_POSITION", "agent");
    const wallet = await open("PLAYER_WALLET");
    await ledger.post({
      idempotencyKey: uid("cash"),
      reason: "deposit",
      entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: 20_000n }],
    });
    expect(await balances(cash, wallet)).toEqual([-20_000n, 20_000n]);
  });

  it("refuses unknown accounts and invalid requests before writing", async () => {
    const wallet = await open("PLAYER_WALLET");
    await expect(
      ledger.post({
        idempotencyKey: uid("missing"),
        reason: "r",
        entries: [{ debitAccountId: 999_999_999n, creditAccountId: wallet.id, amount: 1n }],
      }),
    ).rejects.toMatchObject({ name: "AccountNotFoundError", accountIds: [999_999_999n] });
    await expect(ledger.post({ idempotencyKey: uid("v"), reason: "r", entries: [] })).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuses a leg between accounts of different currencies", async () => {
    const wallet = await open("PLAYER_WALLET");
    // Only ETB is supported by openAccount; a foreign account can only come from raw SQL.
    const [usd] = await db.$queryRaw<{ id: bigint }[]>`
      INSERT INTO accounts (type, owner_kind, owner_id, currency, allow_negative)
      VALUES ('COMPANY_FLOAT', 'company', ${uid("usd")}, 'USD', true) RETURNING id`;
    await db.$executeRaw`INSERT INTO account_balances (account_id) VALUES (${usd!.id})`;
    await expect(
      ledger.post({
        idempotencyKey: uid("fx"),
        reason: "r",
        entries: [{ debitAccountId: usd!.id, creditAccountId: wallet.id, amount: 1n }],
      }),
    ).rejects.toThrow(CurrencyMismatchError);
  });
});

describe("reversal", () => {
  it("replays a retried reversal and refuses a missing or invalid transaction", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const t = await ledger.post({
      idempotencyKey: uid("t"),
      reason: "r",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 700n }],
    });
    const key = uid("rev");
    const first = await ledger.reverse({
      transactionId: t.transaction.id,
      idempotencyKey: key,
      reason: "undo",
    });
    const retry = await ledger.reverse({
      transactionId: t.transaction.id,
      idempotencyKey: key,
      reason: "undo",
    });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(await ledger.getBalance(wallet.id)).toBe(0n);

    await expect(
      ledger.reverse({ transactionId: 999_999_999n, idempotencyKey: uid("x"), reason: "undo" }),
    ).rejects.toThrow(TransactionNotFoundError);
    await expect(
      ledger.reverse({ transactionId: 0n, idempotencyKey: uid("x"), reason: "undo" }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a reversal that would overdraw (the player already spent it)", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const revenue = await open("COMPANY_REVENUE", "company");
    const win = await ledger.post({
      idempotencyKey: uid("win"),
      reason: "win",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 1_000n }],
    });
    await ledger.post({
      idempotencyKey: uid("spend"),
      reason: "bet",
      entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: 900n }],
    });
    await expect(
      ledger.reverse({ transactionId: win.transaction.id, idempotencyKey: uid("rv"), reason: "undo" }),
    ).rejects.toThrow(InsufficientFundsError);
    expect(await ledger.getBalance(wallet.id)).toBe(100n);
  });
});

describe("immutability (enforced by the database)", () => {
  it("rejects UPDATE, DELETE and TRUNCATE on ledger rows", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    const { transaction } = await ledger.post({
      idempotencyKey: uid("imm"),
      reason: "r",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 10n }],
    });
    await expect(
      db.$executeRaw`UPDATE ledger_entries SET amount = 1 WHERE transaction_id = ${transaction.id}`,
    ).rejects.toThrow(/ledger_entries rows are immutable/);
    await expect(
      db.$executeRaw`DELETE FROM ledger_entries WHERE transaction_id = ${transaction.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`UPDATE ledger_transactions SET reason = 'x' WHERE id = ${transaction.id}`,
    ).rejects.toThrow(/ledger_transactions rows are immutable/);
    await expect(
      db.$executeRaw`DELETE FROM ledger_transactions WHERE id = ${transaction.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(db.$executeRawUnsafe("TRUNCATE ledger_entries CASCADE")).rejects.toThrow(/immutable/);
  });

  it("rejects a direct UPDATE or DELETE of a cached balance", async () => {
    const wallet = await open("PLAYER_WALLET");
    await expect(
      db.$executeRaw`UPDATE account_balances SET balance = 1000000 WHERE account_id = ${wallet.id}`,
    ).rejects.toThrow(/can only change through a ledger posting/);
    await expect(
      db.$executeRaw`DELETE FROM account_balances WHERE account_id = ${wallet.id}`,
    ).rejects.toThrow(/ledger posting/);
    expect(await ledger.getBalance(wallet.id)).toBe(0n);
  });
});

describe("reconciliation", () => {
  it("detects cache drift and rebuilds it from the entries", async () => {
    const float = await open("COMPANY_FLOAT", "company");
    const wallet = await open("PLAYER_WALLET");
    await ledger.post({
      idempotencyKey: uid("rec"),
      reason: "r",
      entries: [{ debitAccountId: float.id, creditAccountId: wallet.id, amount: 4_200n }],
    });
    expect(await ledger.reconcile()).toEqual([]);

    // Simulate a bug: corrupt the cache inside a session that claims to be a posting.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('ledger.posting', 'on', true)`;
      await tx.$executeRaw`UPDATE account_balances SET balance = balance + 1 WHERE account_id = ${wallet.id}`;
    });
    expect(await ledger.reconcile()).toEqual([{ accountId: wallet.id, cached: 4_201n, derived: 4_200n }]);
    expect((await ledger.checkInvariants()).ok).toBe(false);

    expect(await ledger.rebuildBalances()).toBe(1);
    expect(await ledger.reconcile()).toEqual([]);
    expect(await ledger.getBalance(wallet.id)).toBe(4_200n);
    expect(await ledger.rebuildBalances()).toBe(0);
  });

  it("reports a non-negative account that went negative", async () => {
    const wallet = await open("PLAYER_WALLET");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('ledger.posting', 'on', true)`;
      await tx.$executeRaw`UPDATE account_balances SET balance = -1 WHERE account_id = ${wallet.id}`;
    });
    const report = await ledger.checkInvariants();
    expect(report.negativeViolations).toContain(wallet.id);
    expect(report.ok).toBe(false);
    await ledger.rebuildBalances();
    expect((await ledger.checkInvariants()).ok).toBe(true);
  });
});

describe("accounts", () => {
  it("opening the same account twice returns the same row with a zero balance", async () => {
    const input = { type: "PLAYER_WALLET" as const, ownerKind: "player" as const, ownerId: uid("p") };
    const a = await ledger.openAccount(input);
    const b = await ledger.openAccount(input);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ currency: "ETB", allowNegative: false, isTest: false });
    expect(await ledger.getBalance(a.id)).toBe(0n);
  });

  it("is safe when opened concurrently", async () => {
    const input = { type: "AGENT_PAYABLE" as const, ownerKind: "agent" as const, ownerId: uid("ag") };
    const opened = await Promise.all(Array.from({ length: 10 }, () => ledger.openAccount(input)));
    expect(new Set(opened.map((a) => a.id)).size).toBe(1);
  });

  it("takes allow_negative from the type and marks test accounts", async () => {
    const cash = await ledger.openAccount({
      type: "AGENT_CASH_POSITION",
      ownerKind: "agent",
      ownerId: uid("a"),
      isTest: true,
    });
    expect(cash).toMatchObject({ allowNegative: true, isTest: true });
  });

  it("refuses bad input and unknown accounts", async () => {
    await expect(
      ledger.openAccount({ type: "NOPE" as AccountType, ownerKind: "player", ownerId: "x" }),
    ).rejects.toThrow(/unknown account type/);
    await expect(
      ledger.openAccount({ type: "PLAYER_WALLET", ownerKind: "staff" as OwnerKind, ownerId: "x" }),
    ).rejects.toThrow(/unknown owner kind/);
    await expect(
      ledger.openAccount({ type: "PLAYER_WALLET", ownerKind: "player", ownerId: " " }),
    ).rejects.toThrow(/ownerId/);
    await expect(ledger.getBalance(999_999_999n)).rejects.toThrow(AccountNotFoundError);
    await expect(ledger.getDerivedBalance(999_999_999n)).rejects.toThrow(AccountNotFoundError);
  });
});
