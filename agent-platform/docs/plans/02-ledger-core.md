# 02 · Ledger core + accounts + idempotency + invariants

Status: **approved 2026-10-19; built and tested locally; deploy next (Day 1).**

## 1. Goal

The one and only way money moves in the system. A double-entry, append-only
ledger in integer santim. Postings are atomic, idempotent and safe under
concurrency. Balances are derived from entries, with a cache that can always be
reconciled and rebuilt. Postgres itself refuses edits and deletes of history.
Later tasks (deposits, bets, settlement) only _call_ this module. None of them
touch money tables directly.

## 2. Scope

**In**

- Tables: `accounts`, `account_balances` (cache), `ledger_transactions`, `ledger_entries`
- `LedgerService`: `openAccount`, `post`, `reverse`, `getBalance`,
  `getDerivedBalance`, `reconcile`, `rebuildBalances`, `checkInvariants`
- DB triggers: entries and transactions are immutable. The balance cache can only
  be written inside a ledger posting.
- Test suites: unit, DB integration, concurrency, property-based invariants

**Not in**

- Any business flow (deposit, bet, withdrawal, settlement): Tasks 05, 06, 07, 10.
  They will define their own entries using the account types below.
- HTTP endpoints: the ledger is internal. Admin read views come in Task 11/12.
- Who owns accounts (the player/agent tables): Task 03. `owner_id` is an opaque string for now.

## 3. Business rules used (CLAUDE.md §5.1, quoted)

- "Double-entry, append-only. Every movement is an immutable row: `debit_account`,
  `credit_account`, `amount`, `currency`, `reason`, `reference_id`,
  `idempotency_key` (unique), `created_at`."
- "Balances are derived from ledger rows (a cached balance table is allowed but must
  be reconcilable and rebuildable)."
- "Never UPDATE a balance directly. Never edit or delete a ledger row. Corrections are
  new reversing entries."
- "All money in integer minor units (no floats)."
- "Every write that touches money runs inside a database transaction with row
  locking; concurrent requests must not double-spend."
- "Invariant: sum of all debits = sum of all credits, and no player/agent wallet goes
  negative unless explicitly allowed."
- Account list from §5.1.

**Open questions:** none block this task. Whether `AGENT_CASH_POSITION` and
`COMPANY_FLOAT` may go negative follows from §5.7 (a deposit _debits_ agent cash)
and §6 (the float funds winnings). If you disagree, it's one line in `ACCOUNT_TYPES`.

## 4. Data model (migration `0002_ledger`)

```sql
accounts(
  id BIGSERIAL PK,
  type TEXT NOT NULL CHECK (type IN (...9 types...)),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('player','agent','company','provider')),
  owner_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  allow_negative BOOLEAN NOT NULL,
  is_test BOOLEAN NOT NULL DEFAULT false,     -- §10: test accounts excluded from reports
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, owner_kind, owner_id, currency))

account_balances(                             -- cache; derivable from entries
  account_id BIGINT PK REFERENCES accounts,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now())

ledger_transactions(                          -- journal header: one per posting
  id BIGSERIAL PK,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,                 -- sha256 of the canonical request
  reason TEXT NOT NULL,
  reference_id TEXT,
  reverses_transaction_id BIGINT UNIQUE REFERENCES ledger_transactions,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())

ledger_entries(                               -- the §5.1 row, exactly
  id BIGSERIAL PK,
  transaction_id BIGINT NOT NULL REFERENCES ledger_transactions,
  debit_account_id BIGINT NOT NULL REFERENCES accounts,
  credit_account_id BIGINT NOT NULL REFERENCES accounts,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,       -- '<txn key>#<n>'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit_account_id <> credit_account_id))
-- indexes: entries(debit_account_id), entries(credit_account_id), entries(transaction_id)
```

**Triggers (raw SQL in the migration)**

- `ledger_entries`, `ledger_transactions`: `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` raise `ledger rows are immutable`.
- `account_balances`: `BEFORE UPDATE OR DELETE` raises unless the transaction-local setting `ledger.posting = 'on'` is set. Only `LedgerService` sets it (`SET LOCAL`). A stray `UPDATE account_balances` from anywhere else fails.

**Why a journal header?** One business event can need several legs (a settlement pays
5 beneficiaries at once). The header gives **one idempotency key for the whole
atomic set**. Each entry still carries every §5.1 field, including its own unique
`idempotency_key`.

**Down:** drop the triggers, then the tables in reverse order (`down.sql`).
**Destructive in prod; only with written approval (§0).**

## 5. API (internal service, no HTTP)

```ts
openAccount({ type, ownerKind, ownerId, isTest? }) → Account   // idempotent
post({ idempotencyKey, reason, referenceId?, entries: [{ debitAccountId, creditAccountId, amount: bigint }] })
  → { transaction, replayed: boolean }
reverse({ transactionId, idempotencyKey, reason }) → { transaction, replayed }
getBalance(accountId) → bigint                  // from cache
getDerivedBalance(accountId) → bigint           // Σcredits − Σdebits from entries
reconcile() → [{ accountId, cached, derived }]  // empty = healthy
rebuildBalances() → number of rows fixed
checkInvariants() → { sumOfBalances, entriesBalanced, negativeViolations[] }
```

Errors are typed: `ValidationError`, `IdempotencyConflictError` (same key, different
request), `InsufficientFundsError`, `AlreadyReversedError`, `AccountNotFoundError`,
`CurrencyMismatchError`.

`allow_negative` comes from the account **type**, never from the caller:

| Type                                                                                      | allow_negative |
| ----------------------------------------------------------------------------------------- | -------------- |
| PLAYER_WALLET, PLAYER_HELD, AGENT_PAYABLE, PARENT_PAYABLE, COMPANY_REVENUE, PROVIDER_FEES | false          |
| AGENT_CASH_POSITION, COMPANY_FLOAT, PROVIDER_PAYABLE                                      | true           |

## 6. Money flow

Convention: **balance = Σ credits − Σ debits.** Each entry moves `amount` from the
debit account to the credit account, so **Σ of all balances = 0 always**.

**Worked example** (illustrative only; real flows are defined in Tasks 05–10).
Amounts in santim (1 ETB = 100).

| #   | Posting                       | Debit → Credit              | Amount              | Float                                                         | Wallet | Revenue | Σ   |
| --- | ----------------------------- | --------------------------- | ------------------- | ------------------------------------------------------------- | ------ | ------- | --- |
| 0   | open accounts                 |                             |                     | 0                                                             | 0      | 0       | 0   |
| 1   | key `t1`                      | FLOAT → WALLET              | 10,000 (100.00 ETB) | −10,000                                                       | 10,000 | 0       | 0   |
| 2   | key `t2`                      | WALLET → REVENUE            | 2,550 (25.50)       | −10,000                                                       | 7,450  | 2,550   | 0   |
| 3   | key `t2` again, same request  | _replayed, nothing written_ |                     | −10,000                                                       | 7,450  | 2,550   | 0   |
| 4   | key `t3`                      | WALLET → REVENUE            | 8,000               | _refused: InsufficientFunds (7,450 < 8,000), nothing written_ |        |         | 0   |
| 5   | reverse `t2`, key `r2`        | REVENUE → WALLET            | 2,550               | −10,000                                                       | 10,000 | 0       | 0   |
| 6   | reverse `t2` again, key `r2b` | _refused: AlreadyReversed_  |                     |                                                               |        |         | 0   |

## 7. Edge cases and failure modes

| Case                                                            | Handling                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Same key retried (network retry)                                | Returns the original transaction with `replayed: true`; nothing written                                                                  |
| Same key, different amounts/accounts                            | `IdempotencyConflictError`; nothing written (request hash compared)                                                                      |
| Two requests with the same key **at the same time**             | The key is re-checked _after_ the account locks are held. Unique-violation fallback: re-read and replay. Exactly one transaction exists. |
| Concurrent spends from one wallet                               | `SELECT … FOR UPDATE` on the balance rows: the second waits, then sees the new balance. No double spend.                                 |
| A↔B transfers in opposite directions at once                    | Locks are always taken in ascending `account_id` order, so no deadlock                                                                   |
| One leg of a multi-leg posting would overdraw                   | The whole posting is refused, so it's all or nothing                                                                                     |
| Amount 0, negative, non-integer or `number` instead of `bigint` | `ValidationError` before touching the DB                                                                                                 |
| Debit = credit, unknown account, mixed currency                 | Validation/DB error; nothing written                                                                                                     |
| Reversal would overdraw (the player already spent it)           | `InsufficientFundsError`; the caller decides (e.g. hold or adjustment)                                                                   |
| Cache drift (bug, manual fix)                                   | `reconcile()` reports it, and `rebuildBalances()` recomputes from entries                                                                |
| Someone runs `UPDATE ledger_entries` / `DELETE`                 | The DB trigger raises an error                                                                                                           |

## 8. Security and permissions

- No HTTP surface. Only server code can call it.
- The DB enforces immutability, independent of app bugs.
- `reason` and `reference_id` are free text for audit. They must never contain full phone numbers or payment references (callers mask them; §7).

## 9. Test plan

**Unit** (no DB): request validation, canonical request hash (stable key order, bigint-safe), `allow_negative` by type.

**DB integration** (real Postgres):

1. The worked example above, step by step, with the exact numbers in the table
2. Replay returns the same transaction id; there's still exactly 1 row
3. Same key with a different payload raises a conflict
4. A multi-leg posting where one leg overdraws: nothing written, balances unchanged
5. An allow-negative account goes negative fine
6. Reversal restores balances; a second reversal is refused; reversing a missing transaction is refused
7. `UPDATE`/`DELETE` on entries and transactions are rejected by the DB; direct `UPDATE account_balances` is rejected
8. Drift: corrupt the cache inside a deliberately flagged session → `reconcile` finds 1 mismatch → `rebuildBalances` fixes it → `reconcile` is empty
9. `openAccount` is idempotent: same account twice gives the same id

**Concurrency**

- Wallet with 100.00 ETB, **50 parallel** spends of 10.00 ETB: exactly 10 succeed, 40 are refused with InsufficientFunds, the final balance is 0, and it never goes negative
- **20 parallel** posts with the same key: exactly 1 transaction, 20 identical results
- 30 parallel opposite-direction A↔B transfers: no deadlock, Σ = 0

**Property-based** (fast-check, 100 runs): random sequences of postings between random
accounts with random amounts. After each run: Σ balances = 0, cache = derived for
every account, and no non-negative account is below 0.

## 10. Deployment plan

- Additive migration (new tables only). There's no feature flag because nothing calls the ledger yet.
- Before deploy: backup. After deploy: run `checkInvariants()` through a one-off script (`npm run ledger:check`), expecting Σ = 0 and no violations.
- **Rollback:** redeploy the previous image. Leaving the tables in place is safe (they're unused).

## 11. Risks and assumptions

- `account_balances` is a cache written inside postings. The rule "Never UPDATE a balance
  directly" is enforced as _only the ledger may, inside a posting_ (the DB trigger checks).
  Flag this if you read §5.1 more strictly (pure SUM, no cache). The cost then is
  a `SUM()` per bet.
- `PROVIDER_PAYABLE` may go negative (we can owe or be owed). Confirm with Task 07.
- Single currency (ETB) for now; the currency column keeps the door open.

## 12. Definition of done

- [x] All unit, DB, concurrency and property tests pass locally (real output in the report)
- [x] 100% line/branch coverage of `src/ledger/**`
- [ ] CI green (needs Q-13)
- [ ] Deployed with `ledger:check` clean (needs Task 01 deploy)
