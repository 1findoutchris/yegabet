/*
 * Self-check for agent ledger math — the two balances derived from one table.
 * Run: `npx tsx src/lib/agentLedger.check.ts`
 */
import assert from "node:assert";
import { agentPosition, floatDelta, FLOAT_TYPES, OUTSTANDING_TYPES, type LedgerSum } from "./agentLedger";

const rows = (m: Record<string, number>): LedgerSum[] =>
  Object.entries(m).map(([type, amount]) => ({ type, _sum: { amount } }));

// ── the two rails never share a row type ────────────────────────────────────
// This is what lets an agent do both jobs without one balance moving the other.
{
  const overlap = FLOAT_TYPES.filter((t) => (OUTSTANDING_TYPES as readonly string[]).includes(t));
  assert.deepStrictEqual(overlap, [], "float and outstanding must not share a row type");
}

// ── empty ledger is zero on both rails ──────────────────────────────────────
{
  const p = agentPosition([]);
  assert.strictEqual(p.outstanding, 0);
  assert.strictEqual(p.float, 0);
}

// ── outstanding: unchanged by the cash rail ─────────────────────────────────
{
  const payoutOnly = agentPosition(rows({ PAYOUT: 1000, COMMISSION: 30, SETTLEMENT: 400 }));
  assert.strictEqual(payoutOnly.outstanding, 630);

  // Same agent now also runs a busy cash counter. `outstanding` must not budge —
  // this is the regression that would silently overpay an agent at settlement.
  const both = agentPosition(rows({
    PAYOUT: 1000, COMMISSION: 30, SETTLEMENT: 400,
    TOPUP: 5000, CASH_DEPOSIT: 1200, CASH_PAYOUT: 300, FLOAT_RETURN: 100,
  }));
  assert.strictEqual(both.outstanding, 630, "cash rows must not move outstanding");
  assert.strictEqual(both.float, 5000 + 300 - 1200 - 100);
}

// ── float: top-up adds, crediting a player spends, paying cash out returns ──
{
  const p = agentPosition(rows({ TOPUP: 10_000, CASH_DEPOSIT: 2500 }));
  assert.strictEqual(p.float, 7500, "crediting a player spends float");

  // Paying cash to a player takes their balance in return, so float goes up.
  const q = agentPosition(rows({ TOPUP: 10_000, CASH_DEPOSIT: 2500, CASH_PAYOUT: 900 }));
  assert.strictEqual(q.float, 8400);
}

// ── FLOAT_RETURN is the undo for a mistyped top-up ──────────────────────────
{
  const p = agentPosition(rows({ TOPUP: 50_000, FLOAT_RETURN: 45_000 }));
  assert.strictEqual(p.float, 5000, "a wrong top-up is reversible without editing rows");
}

// ── commission belongs to the payout rail only ──────────────────────────────
{
  const p = agentPosition(rows({ COMMISSION: 900 }));
  assert.strictEqual(p.float, 0, "COMMISSION must not credit float");
  assert.strictEqual(p.outstanding, 900);
}

// ── cash commission accrues, then releases into float ───────────────────────
// The whole point of the split: an agent cannot spend this month's commission
// until the 1st, but it is visible and owed the moment it is earned.
{
  const accrued = agentPosition(rows({ TOPUP: 1000, CASH_COMMISSION: 250 }));
  assert.strictEqual(accrued.pendingCommission, 250);
  assert.strictEqual(accrued.float, 1000, "accrued commission is not spendable yet");

  const afterRelease = agentPosition(rows({ TOPUP: 1000, CASH_COMMISSION: 250, COMMISSION_PAYOUT: 250 }));
  assert.strictEqual(afterRelease.pendingCommission, 0, "released commission is no longer pending");
  assert.strictEqual(afterRelease.float, 1250, "released commission is spendable");
  assert.strictEqual(afterRelease.outstanding, 0, "the cash rail never touches outstanding");
}

// ── a second release in the same month would double-pay ─────────────────────
// The cron guards this with a per-month refId; the arithmetic below is what
// makes that guard necessary, so it is pinned here as the reason.
{
  const p = agentPosition(rows({ CASH_COMMISSION: 250, COMMISSION_PAYOUT: 500 }));
  assert.strictEqual(p.pendingCommission, -250, "a double release shows as negative pending");
}

// ── commission keeps accruing after a release ───────────────────────────────
{
  const p = agentPosition(rows({ CASH_COMMISSION: 400, COMMISSION_PAYOUT: 250 }));
  assert.strictEqual(p.pendingCommission, 150, "only the unreleased remainder is pending");
}

// ── a cancelled deposit leaves the agent exactly where they started ─────────
// Both halves have to reverse: the float AND the commission it earned. Undoing
// only the float would pay an agent commission on a deposit that never stood.
{
  const before = agentPosition(rows({ TOPUP: 1000 }));
  const after = agentPosition(rows({
    TOPUP: 1000,
    CASH_DEPOSIT: 300, CASH_COMMISSION: 15,
    CASH_REVERSAL: 300, CASH_COMMISSION_REVERSAL: 15,
  }));
  assert.strictEqual(after.float, before.float, "a cancelled deposit restores the float");
  assert.strictEqual(after.pendingCommission, 0, "and pays no commission on it");
}

// ── cancelling one of several deposits only unwinds that one ────────────────
{
  const p = agentPosition(rows({
    TOPUP: 1000,
    CASH_DEPOSIT: 500, CASH_COMMISSION: 25,
    CASH_REVERSAL: 200, CASH_COMMISSION_REVERSAL: 10,
  }));
  assert.strictEqual(p.float, 700, "1000 − 500 + 200");
  assert.strictEqual(p.pendingCommission, 15, "25 earned − 10 given back");
}

// ── rounding holds across many small rows ───────────────────────────────────
{
  const p = agentPosition(rows({ TOPUP: 0.1 + 0.2, CASH_DEPOSIT: 0.3 }));
  assert.strictEqual(p.float, 0, "float must not drift on float-point sums");
}

// ── floatDelta agrees with agentPosition ────────────────────────────────────
{
  assert.strictEqual(floatDelta("TOPUP", 100), 100);
  assert.strictEqual(floatDelta("CASH_PAYOUT", 100), 100);
  assert.strictEqual(floatDelta("CASH_DEPOSIT", 100), -100);
  assert.strictEqual(floatDelta("FLOAT_RETURN", 100), -100);
  assert.strictEqual(floatDelta("COMMISSION_PAYOUT", 100), 100);
  assert.strictEqual(floatDelta("CASH_REVERSAL", 100), 100);
  assert.strictEqual(floatDelta("CASH_COMMISSION", 100), 0, "accrual alone must not move float");
  assert.strictEqual(floatDelta("CASH_COMMISSION_REVERSAL", 100), 0, "nor does clawing it back");
  for (const t of OUTSTANDING_TYPES) {
    assert.strictEqual(floatDelta(t, 100), 0, `${t} must not move float`);
  }
}

// ── unknown row types are inert on both rails ───────────────────────────────
// A future row type must not be silently counted as money until it's wired in.
{
  const p = agentPosition(rows({ SOMETHING_NEW: 9999 }));
  assert.strictEqual(p.float, 0);
  assert.strictEqual(p.outstanding, 0);
}
