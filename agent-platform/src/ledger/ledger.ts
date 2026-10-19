import { Prisma, PrismaClient } from "@prisma/client";
import {
  ACCOUNT_TYPES,
  CURRENCY,
  isAccountType,
  isOwnerKind,
  type AccountType,
  type OwnerKind,
} from "./accountTypes";
import {
  AccountNotFoundError,
  AlreadyReversedError,
  CurrencyMismatchError,
  IdempotencyConflictError,
  InsufficientFundsError,
  TransactionNotFoundError,
  ValidationError,
} from "./errors";
import { requestHash, validatePosting, type Leg, type PostingRequest } from "./request";

/**
 * The only way money moves (CLAUDE.md §5.1, plan 02). Framework-free on
 * purpose: Nest wraps it (ledger.module.ts), tests use it directly.
 *
 * Every posting runs in one DB transaction that:
 *   1. marks itself as a ledger posting (SET LOCAL ledger.posting = 'on'),
 *      the only way past the account_balances trigger;
 *   2. row-locks every touched balance in ascending account id order
 *      (no deadlock between opposite-direction transfers);
 *   3. checks the idempotency key again *under* those locks, so a concurrent
 *      duplicate replays instead of double-posting;
 *   4. refuses the whole posting if any non-negative account would end below 0;
 *   5. appends the journal header + entries and updates the cached balances.
 */

type Tx = Prisma.TransactionClient;

export interface Account {
  id: bigint;
  type: string;
  ownerKind: string;
  ownerId: string;
  currency: string;
  allowNegative: boolean;
  isTest: boolean;
}

export interface PostedTransaction {
  id: bigint;
  idempotencyKey: string;
  reason: string;
  referenceId: string | null;
  reversesTransactionId: bigint | null;
  createdAt: Date;
  entries: { debitAccountId: bigint; creditAccountId: bigint; amount: bigint; currency: string }[];
}

export interface PostingResult {
  transaction: PostedTransaction;
  /** true when the key had already been posted with the same request: nothing new was written. */
  replayed: boolean;
}

export interface InvariantReport {
  /** Σ cached balances: must be 0 (every entry adds to one account what it takes from another). */
  sumOfBalances: bigint;
  /** Σ balances derived from entries: must be 0. */
  sumOfDerived: bigint;
  /** Accounts that may not go negative but are. Must be empty. */
  negativeViolations: bigint[];
  ok: boolean;
}

export interface LedgerOptions {
  /** Max time one posting may hold its locks (ms). */
  timeoutMs?: number;
  /** Max wait for a pooled connection (ms). */
  maxWaitMs?: number;
}

interface LockedRow {
  id: bigint;
  currency: string;
  allow_negative: boolean;
  balance: bigint;
}

const TXN_INCLUDE = {
  entries: {
    orderBy: { id: "asc" },
    select: { debitAccountId: true, creditAccountId: true, amount: true, currency: true },
  },
} satisfies Prisma.LedgerTransactionInclude;

function isUniqueViolation(e: unknown, column: string): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(JSON.stringify(e.meta)).includes(column)
  );
}

export class Ledger {
  private readonly txOptions: { timeout: number; maxWait: number };

  constructor(
    private readonly db: PrismaClient,
    options: LedgerOptions = {},
  ) {
    this.txOptions = { timeout: options.timeoutMs ?? 10_000, maxWait: options.maxWaitMs ?? 10_000 };
  }

  // ── Accounts ────────────────────────────────────────────────────────────────

  /**
   * Open (or return the existing) account. Idempotent; creates its zero balance row.
   * Pass `client` (a transaction) to open it atomically with the caller's own rows.
   */
  async openAccount(
    input: {
      type: AccountType;
      ownerKind: OwnerKind;
      ownerId: string;
      isTest?: boolean;
    },
    client: Tx | PrismaClient = this.db,
  ): Promise<Account> {
    if (!isAccountType(input.type)) throw new ValidationError(`unknown account type: ${String(input.type)}`);
    if (!isOwnerKind(input.ownerKind))
      throw new ValidationError(`unknown owner kind: ${String(input.ownerKind)}`);
    if (typeof input.ownerId !== "string" || input.ownerId.trim() === "") {
      throw new ValidationError("ownerId must be a non-empty string");
    }
    const where = {
      type_ownerKind_ownerId_currency: {
        type: input.type,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        currency: CURRENCY,
      },
    };
    const existing = await client.account.findUnique({ where });
    if (existing) return existing;
    try {
      return await client.account.create({
        data: {
          type: input.type,
          ownerKind: input.ownerKind,
          ownerId: input.ownerId,
          currency: CURRENCY,
          allowNegative: ACCOUNT_TYPES[input.type].allowNegative,
          isTest: input.isTest ?? false,
          balance: { create: {} },
        },
      });
    } catch (e) {
      // Opened concurrently by another caller: theirs is the account.
      if (isUniqueViolation(e, "type")) return client.account.findUniqueOrThrow({ where });
      /* istanbul ignore next -- any other DB error propagates unchanged */
      throw e;
    }
  }

  // ── Posting ─────────────────────────────────────────────────────────────────

  async post(raw: PostingRequest): Promise<PostingResult> {
    const req = validatePosting(raw);
    const hash = requestHash("post", { ...req });
    return this.run(req.idempotencyKey, hash, (tx) => this.apply(tx, req, hash, null));
  }

  /**
   * The same posting, inside the caller's own transaction, so a business row
   * (e.g. a deposit's status) and its money move commit or roll back together.
   * Same locks, same idempotency, same refusals. If two callers race on one
   * key, the loser's transaction fails on the unique key and the caller
   * retries (a retry then replays).
   */
  async postInTransaction(tx: Tx, raw: PostingRequest): Promise<PostingResult> {
    const req = validatePosting(raw);
    const hash = requestHash("post", { ...req });
    await tx.$executeRaw`SELECT set_config('ledger.posting', 'on', true)`;
    return this.apply(tx, req, hash, null);
  }

  /**
   * Undo a transaction with a new, opposite transaction (corrections are new
   * entries, never edits). A transaction can be reversed at most once.
   */
  async reverse(input: {
    transactionId: bigint;
    idempotencyKey: string;
    reason: string;
  }): Promise<PostingResult> {
    if (typeof input.transactionId !== "bigint" || input.transactionId <= 0n) {
      throw new ValidationError("transactionId must be a positive bigint");
    }
    const hash = requestHash("reverse", {
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    return this.run(input.idempotencyKey, hash, async (tx) => {
      const original = await tx.ledgerTransaction.findUnique({
        where: { id: input.transactionId },
        include: TXN_INCLUDE,
      });
      if (!original) throw new TransactionNotFoundError(input.transactionId);
      const req = validatePosting({
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        referenceId: original.referenceId ?? undefined,
        entries: original.entries.map((e) => ({
          debitAccountId: e.creditAccountId,
          creditAccountId: e.debitAccountId,
          amount: e.amount,
        })),
      });
      return this.apply(tx, req, hash, original.id);
    });
  }

  /** Transaction wrapper shared by post/reverse: maps a lost duplicate race to a replay. */
  private async run(
    key: string,
    hash: string,
    body: (tx: Tx) => Promise<PostingResult>,
  ): Promise<PostingResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('ledger.posting', 'on', true)`;
        return body(tx);
      }, this.txOptions);
    } catch (e) {
      // The same key raced in on accounts we didn't lock, so the check under
      // the locks couldn't see it. That's only possible with a *different*
      // request (same request = same accounts = serialized by the locks), so
      // replay() throws IdempotencyConflictError here.
      if (isUniqueViolation(e, "idempotency_key")) {
        const replay = await this.replay(this.db, key, hash);
        /* istanbul ignore next -- defensive: a same-request duplicate is caught under the locks */
        if (replay) return replay;
      }
      throw e;
    }
  }

  /** The stored result for `key`, if any. Throws if it was posted with a different request. */
  private async replay(db: Tx | PrismaClient, key: string, hash: string): Promise<PostingResult | null> {
    const prior = await db.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
      include: TXN_INCLUDE,
    });
    if (!prior) return null;
    if (prior.requestHash !== hash) throw new IdempotencyConflictError(key);
    return { transaction: toPosted(prior), replayed: true };
  }

  private async apply(
    tx: Tx,
    req: PostingRequest,
    hash: string,
    reverses: bigint | null,
  ): Promise<PostingResult> {
    // Distinct ids (the Set), locked in ascending order.
    const ids = [...new Set(req.entries.flatMap((l) => [l.debitAccountId, l.creditAccountId]))].sort(
      (a, b) => (a < b ? -1 : 1),
    );

    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT a.id, a.currency, a.allow_negative, b.balance
      FROM accounts a JOIN account_balances b ON b.account_id = a.id
      WHERE a.id IN (${Prisma.join(ids)})
      ORDER BY a.id
      FOR UPDATE OF b`;
    if (rows.length !== ids.length) {
      const found = new Set(rows.map((r) => r.id));
      throw new AccountNotFoundError(ids.filter((id) => !found.has(id)));
    }
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Checked again under the locks: a concurrent duplicate has committed by now.
    const replay = await this.replay(tx, req.idempotencyKey, hash);
    if (replay) return replay;
    if (reverses !== null) {
      const already = await tx.ledgerTransaction.findUnique({ where: { reversesTransactionId: reverses } });
      if (already) throw new AlreadyReversedError(reverses);
    }

    const delta = new Map<bigint, bigint>();
    const legs = req.entries.map((leg: Leg) => {
      const debit = byId.get(leg.debitAccountId) as LockedRow;
      const credit = byId.get(leg.creditAccountId) as LockedRow;
      if (debit.currency !== credit.currency) throw new CurrencyMismatchError(debit.id, credit.id);
      delta.set(debit.id, (delta.get(debit.id) ?? 0n) - leg.amount);
      delta.set(credit.id, (delta.get(credit.id) ?? 0n) + leg.amount);
      return { ...leg, currency: debit.currency };
    });

    const next = new Map<bigint, bigint>();
    for (const [id, change] of delta) {
      const row = byId.get(id) as LockedRow;
      const balance = row.balance + change;
      if (balance < 0n && !row.allow_negative) throw new InsufficientFundsError(id, row.balance, change);
      next.set(id, balance);
    }

    const created = await tx.ledgerTransaction.create({
      data: {
        idempotencyKey: req.idempotencyKey,
        requestHash: hash,
        reason: req.reason,
        referenceId: req.referenceId ?? null,
        reversesTransactionId: reverses,
        entries: {
          create: legs.map((l, i) => ({
            debitAccountId: l.debitAccountId,
            creditAccountId: l.creditAccountId,
            amount: l.amount,
            currency: l.currency,
            reason: req.reason,
            referenceId: req.referenceId ?? null,
            idempotencyKey: `${req.idempotencyKey}#${i}`,
          })),
        },
      },
      include: TXN_INCLUDE,
    });
    for (const [accountId, balance] of next) {
      await tx.accountBalance.update({ where: { accountId }, data: { balance, updatedAt: new Date() } });
    }
    return { transaction: toPosted(created), replayed: false };
  }

  // ── Reads, reconciliation, invariants ─────────────────────────────────────

  /** Cached balance (fast path). */
  async getBalance(accountId: bigint): Promise<bigint> {
    const row = await this.db.accountBalance.findUnique({ where: { accountId } });
    if (!row) throw new AccountNotFoundError([accountId]);
    return row.balance;
  }

  /** Balance recomputed from entries: Σ credits − Σ debits. */
  async getDerivedBalance(accountId: bigint): Promise<bigint> {
    await this.getBalance(accountId);
    const [row] = await this.db.$queryRaw<{ balance: bigint }[]>`
      SELECT (
        (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE credit_account_id = ${accountId}) -
        (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE debit_account_id = ${accountId})
      )::bigint AS balance`;
    return (row as { balance: bigint }).balance;
  }

  /** Accounts whose cached balance differs from the entries. Empty = healthy. */
  async reconcile(): Promise<{ accountId: bigint; cached: bigint; derived: bigint }[]> {
    const rows = await this.db.$queryRaw<{ account_id: bigint; cached: bigint; derived: bigint }[]>`
      ${DERIVED_CTE}
      SELECT b.account_id, b.balance AS cached, d.derived
      FROM derived d JOIN account_balances b ON b.account_id = d.id
      WHERE b.balance <> d.derived
      ORDER BY b.account_id`;
    return rows.map((r) => ({ accountId: r.account_id, cached: r.cached, derived: r.derived }));
  }

  /**
   * Recompute every cached balance from the entries. Blocks new postings while
   * it runs (SHARE lock on ledger_entries), so it can't race a posting.
   * Returns how many balances were wrong.
   */
  async rebuildBalances(): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('ledger.posting', 'on', true)`;
      await tx.$executeRaw`LOCK TABLE ledger_entries IN SHARE MODE`;
      return tx.$executeRaw`
        ${DERIVED_CTE}
        UPDATE account_balances b SET balance = d.derived, updated_at = now()
        FROM derived d
        WHERE b.account_id = d.id AND b.balance <> d.derived`;
    }, this.txOptions);
  }

  async checkInvariants(): Promise<InvariantReport> {
    const [sums] = await this.db.$queryRaw<{ cached: bigint; derived: bigint }[]>`
      ${DERIVED_CTE}
      SELECT
        (SELECT COALESCE(SUM(balance), 0) FROM account_balances)::bigint AS cached,
        (SELECT COALESCE(SUM(derived), 0) FROM derived)::bigint AS derived`;
    const negatives = await this.db.$queryRaw<{ id: bigint }[]>`
      SELECT a.id FROM accounts a JOIN account_balances b ON b.account_id = a.id
      WHERE NOT a.allow_negative AND b.balance < 0
      ORDER BY a.id`;
    const { cached, derived } = sums as { cached: bigint; derived: bigint };
    const negativeViolations = negatives.map((r) => r.id);
    return {
      sumOfBalances: cached,
      sumOfDerived: derived,
      negativeViolations,
      ok: cached === 0n && derived === 0n && negativeViolations.length === 0,
    };
  }
}

/** Per-account balance derived from entries, for every account (including ones with no entries). */
const DERIVED_CTE = Prisma.sql`
  WITH derived AS (
    SELECT a.id, (COALESCE(c.total, 0) - COALESCE(d.total, 0))::bigint AS derived
    FROM accounts a
    LEFT JOIN (SELECT credit_account_id AS id, SUM(amount) AS total FROM ledger_entries GROUP BY 1) c ON c.id = a.id
    LEFT JOIN (SELECT debit_account_id AS id, SUM(amount) AS total FROM ledger_entries GROUP BY 1) d ON d.id = a.id
  )`;

function toPosted(t: Prisma.LedgerTransactionGetPayload<{ include: typeof TXN_INCLUDE }>): PostedTransaction {
  return {
    id: t.id,
    idempotencyKey: t.idempotencyKey,
    reason: t.reason,
    referenceId: t.referenceId,
    reversesTransactionId: t.reversesTransactionId,
    createdAt: t.createdAt,
    entries: t.entries,
  };
}
