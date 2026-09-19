/*
 * Self-check for the deposit/withdrawal limit band — it's what an admin types
 * to cap money moving in and out, and the same function phrases the client-side
 * hint and the server-side rejection, so the boundaries get pinned.
 * Run: `npx tsx src/lib/paymentLimits.check.ts`
 */
import assert from "node:assert";
import { DEFAULT_LIMITS, limitError, limitsFor } from "./paymentLimits";

const band = { min: 50, max: 1000 };

// Boundaries are inclusive both ends.
assert.strictEqual(limitError(50, "deposit", band), null);
assert.strictEqual(limitError(1000, "deposit", band), null);
assert.strictEqual(limitError(500, "deposit", band), null);

assert.match(limitError(49.99, "deposit", band)!, /minimum deposit is etb 50/i);
assert.match(limitError(1000.01, "deposit", band)!, /maximum deposit is etb 1,000/i);
assert.match(limitError(0, "withdraw", band)!, /minimum withdrawal/i);
assert.match(limitError(5000, "withdraw", band)!, /maximum withdrawal/i);

// A degenerate band (min === max) allows exactly one amount rather than none.
assert.strictEqual(limitError(200, "deposit", { min: 200, max: 200 }), null);
assert.ok(limitError(201, "deposit", { min: 200, max: 200 }));

// Direction picks the matching pair — swapping them would silently apply the
// deposit cap to payouts.
const l = { minDeposit: 10, maxDeposit: 20, minWithdraw: 30, maxWithdraw: 40 };
assert.deepStrictEqual(limitsFor(l, "deposit"), { min: 10, max: 20 });
assert.deepStrictEqual(limitsFor(l, "withdraw"), { min: 30, max: 40 });

// The defaults are the constants the routes used to hardcode; changing one
// silently loosens every method that has never been edited.
assert.deepStrictEqual(DEFAULT_LIMITS, {
  minDeposit: 50, maxDeposit: 100_000, minWithdraw: 50, maxWithdraw: 100_000,
});
