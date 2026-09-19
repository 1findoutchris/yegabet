/*
 * Self-check for admin adjustment pot math.
 * Run: `npx tsx src/lib/adminAdjust.check.ts`
 */
import assert from "node:assert";
import { applyAdjustment } from "./adminAdjust";
import { withdrawable, type Wallet } from "./wallet";

const w = (balance: number, depositBalance: number, bonusBalance: number): Wallet =>
  ({ balance, depositBalance, bonusBalance });

const ok = (r: ReturnType<typeof applyAdjustment>) => {
  assert.ok(r.ok, `expected success, got: ${r.ok ? "" : r.error}`);
  return r;
};

/** Pots must still sum to the balance after any adjustment. */
const invariant = (x: Wallet, label: string) =>
  assert.strictEqual(
    Math.round((x.depositBalance + x.bonusBalance + withdrawable(x)) * 100) / 100,
    Math.round(x.balance * 100) / 100,
    `pots must sum to balance: ${label}`,
  );

// ── credits raise the total and the named pot together ──────────────────────
{
  const r = ok(applyAdjustment(w(0, 0, 0), "deposit", 500));
  assert.deepStrictEqual(r.update, w(500, 500, 0));
  assert.strictEqual(withdrawable(r.update), 0, "a deposit credit is not withdrawable");
  invariant(r.update, "deposit credit");
}
{
  const r = ok(applyAdjustment(w(0, 0, 0), "bonus", 100));
  assert.deepStrictEqual(r.update, w(100, 0, 100));
  assert.strictEqual(withdrawable(r.update), 0, "a bonus credit is not withdrawable");
  invariant(r.update, "bonus credit");
}
{
  const r = ok(applyAdjustment(w(0, 0, 0), "withdrawable", 250));
  assert.deepStrictEqual(r.update, w(250, 0, 0));
  assert.strictEqual(withdrawable(r.update), 250, "a withdrawable credit is cash");
  invariant(r.update, "withdrawable credit");
}

// ── a deduction only ever touches the pot the admin picked ──────────────────
{
  // Deducting deposit must leave bonus and winnings alone.
  const r = ok(applyAdjustment(w(180, 100, 50), "deposit", -60));
  assert.deepStrictEqual(r.update, w(120, 40, 50));
  assert.strictEqual(withdrawable(r.update), 30, "winnings untouched");
  invariant(r.update, "deposit deduction");
}
{
  const r = ok(applyAdjustment(w(180, 100, 50), "bonus", -50));
  assert.deepStrictEqual(r.update, w(130, 100, 0));
  assert.strictEqual(withdrawable(r.update), 30, "winnings untouched");
  invariant(r.update, "bonus deduction");
}
{
  const r = ok(applyAdjustment(w(180, 100, 50), "withdrawable", -30));
  assert.deepStrictEqual(r.update, w(150, 100, 50));
  assert.strictEqual(withdrawable(r.update), 0);
  invariant(r.update, "withdrawable deduction");
}

// ── a pot can never be overdrawn ────────────────────────────────────────────
{
  // Only 30 is withdrawable even though the balance is 180 — the rest is
  // deposit and bonus, and picking "withdrawable" must not reach into them.
  const r = applyAdjustment(w(180, 100, 50), "withdrawable", -31);
  assert.ok(!r.ok, "must not deduct more than the withdrawable pot holds");
  assert.match(r.ok ? "" : r.error, /withdrawable/i);
}
assert.ok(!applyAdjustment(w(180, 100, 50), "deposit", -101).ok, "deposit pot overdraft");
assert.ok(!applyAdjustment(w(180, 100, 50), "bonus", -51).ok, "bonus pot overdraft");

// Draining a pot to exactly zero is allowed (boundary, not an off-by-one).
{
  const r = ok(applyAdjustment(w(180, 100, 50), "deposit", -100));
  assert.strictEqual(r.update.depositBalance, 0);
  invariant(r.update, "exact drain");
}
assert.ok(applyAdjustment(w(180, 100, 50), "withdrawable", -30).ok);

// ── ledger before/after report the targeted pot, not the total ──────────────
{
  const r = ok(applyAdjustment(w(180, 100, 50), "bonus", 25));
  assert.strictEqual(r.before, 50, "before = the bonus pot");
  assert.strictEqual(r.after, 75, "after = the bonus pot");
}
{
  const r = ok(applyAdjustment(w(180, 100, 50), "withdrawable", 20));
  assert.strictEqual(r.before, 30);
  assert.strictEqual(r.after, 50);
}

// ── money stays at 2dp ──────────────────────────────────────────────────────
{
  const r = ok(applyAdjustment(w(0.1, 0.1, 0), "withdrawable", 0.2));
  assert.strictEqual(r.update.balance, 0.3, "0.1 + 0.2 must not leak float error");
}

console.log("adminAdjust self-check passed");
