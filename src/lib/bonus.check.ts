/*
 * Self-check for the points-redemption math and the pooled-bonus invariant.
 * Run: `npx tsx src/lib/bonus.check.ts`
 *
 * Imports only from ./retention (client-safe, no `server-only`) so this runs
 * under plain node — ./bonus.ts and ./loyalty.ts would throw on the import.
 */
import assert from "node:assert";
import {
  quoteRedemption,
  maxRedeemablePoints,
  POINTS_PER_ETB,
  MIN_REDEEM_POINTS,
} from "./retention";
import { credit, withdrawable, type Wallet } from "./wallet";

const w = (balance: number, depositBalance: number, bonusBalance: number): Wallet =>
  ({ balance, depositBalance, bonusBalance });

const RATE = POINTS_PER_ETB;   // 50
const MIN = MIN_REDEEM_POINTS; // 500

// ── Pricing is exact for every valid multiple ────────────────────────────────
for (let p = MIN; p <= MIN * 40; p += RATE) {
  const r = quoteRedemption(p, p, RATE, MIN);
  assert.ok(r.ok, `expected ${p} points to be redeemable`);
  assert.strictEqual(r.quote.etb, p / RATE);
  assert.strictEqual(r.quote.etb, Math.round(r.quote.etb), "ETB payout must be exact, never fractional");
}

// ── Rejections ───────────────────────────────────────────────────────────────
const reject = (points: number, available: number) => {
  const r = quoteRedemption(points, available, RATE, MIN);
  assert.ok(!r.ok, `expected ${points} of ${available} to be rejected`);
  return r.error;
};

reject(MIN - RATE, 10_000);        // below the minimum
reject(MIN + 1, 10_000);           // not a multiple of the rate
reject(0, 10_000);                 // zero
reject(-MIN, 10_000);              // negative
reject(1.5 * RATE, 10_000);        // non-integer
reject(MIN, MIN - 1);              // more than the player holds

// The "not enough points" case must be distinguishable from a malformed amount,
// since the route maps them to different messages.
assert.match(reject(MIN, MIN - 1), /not enough/i);

// Spending exactly the whole balance is allowed (boundary, not an off-by-one).
assert.ok(quoteRedemption(MIN, MIN, RATE, MIN).ok);

// ── maxRedeemablePoints rounds down to a whole multiple ──────────────────────
assert.strictEqual(maxRedeemablePoints(1_234, RATE, MIN), 1_200);
assert.strictEqual(maxRedeemablePoints(MIN, RATE, MIN), MIN);
assert.strictEqual(maxRedeemablePoints(MIN - 1, RATE, MIN), 0, "below the minimum → nothing to redeem");
assert.strictEqual(maxRedeemablePoints(0, RATE, MIN), 0);
// Whatever it returns must itself be redeemable — this is what the UI preselects.
for (const held of [499, 500, 501, 999, 1_000, 12_345]) {
  const max = maxRedeemablePoints(held, RATE, MIN);
  if (max > 0) assert.ok(quoteRedemption(max, held, RATE, MIN).ok, `max of ${held} must be redeemable`);
}

// ── The two payout pots grantBonus can target ────────────────────────────────
// grantBonus takes `pot: "bonus" | "withdrawable"`; it can't be imported here
// (server-only), but it delegates to exactly these semantics, and the prize
// wheel pays headline prizes into the withdrawable one. If this pair ever stops
// differing, a "100,000 ETB" wheel prize silently becomes locked credit — or,
// worse, every bonus in the app becomes withdrawable.
{
  const start = w(0, 0, 0);

  const asBonus = credit(start, 100, "bonus");
  assert.strictEqual(asBonus.balance, 100, "bonus credit is playable");
  assert.strictEqual(withdrawable(asBonus), 0, "bonus credit is NOT withdrawable");

  const asCash = credit(start, 100, "withdrawable");
  assert.strictEqual(asCash.balance, 100, "withdrawable credit is playable");
  assert.strictEqual(withdrawable(asCash), 100, "withdrawable credit IS withdrawable");
  assert.strictEqual(asCash.bonusBalance, 0, "withdrawable credit must not touch the bonus pot");
}

console.log("bonus self-check passed");
