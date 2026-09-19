/*
 * Self-check for payout-agent routing and SLA rules.
 * Run: `npx tsx src/lib/payoutRouting.check.ts`
 */
import assert from "node:assert";
import { pickLeastLoaded, slaState, minutesBetween, type AgentLoad } from "./payoutRouting";

const a = (id: string, open: number): AgentLoad => ({ id, open });

// ── least-loaded routing ────────────────────────────────────────────────────
assert.strictEqual(pickLeastLoaded([]), null, "no eligible agent → nobody");
assert.strictEqual(pickLeastLoaded([a("solo", 99)]), "solo", "the only agent takes it even when busy");
assert.strictEqual(pickLeastLoaded([a("busy", 5), a("free", 0), a("mid", 2)]), "free");

// Ties break deterministically on id, so equal load rotates rather than
// always landing on whichever row the DB returned first.
assert.strictEqual(pickLeastLoaded([a("zeta", 3), a("alpha", 3)]), "alpha");
assert.strictEqual(pickLeastLoaded([a("alpha", 3), a("zeta", 3)]), "alpha", "order of input must not matter");

// Work actually spreads: feed assignments back in and nobody runs away with it.
{
  const load = new Map([["a1", 0], ["a2", 0], ["a3", 0]]);
  for (let i = 0; i < 30; i++) {
    const picked = pickLeastLoaded([...load].map(([id, open]) => a(id, open)))!;
    load.set(picked, load.get(picked)! + 1);
  }
  const counts = [...load.values()];
  assert.deepStrictEqual(counts, [10, 10, 10], "30 requests across 3 agents must split evenly");
}
{
  // An agent starting behind gets fed until they catch up, not before.
  const load = new Map([["a1", 4], ["a2", 0]]);
  for (let i = 0; i < 4; i++) {
    const picked = pickLeastLoaded([...load].map(([id, open]) => a(id, open)))!;
    assert.strictEqual(picked, "a2", "the idle agent absorbs work until level");
    load.set(picked, load.get(picked)! + 1);
  }
  assert.strictEqual(pickLeastLoaded([...load].map(([id, open]) => a(id, open))), "a1", "then it alternates");
}

// ── SLA clock ───────────────────────────────────────────────────────────────
const t = (min: number) => new Date(Date.UTC(2026, 6, 31, 14, 0, 0) + min * 60_000);

assert.strictEqual(slaState(null, null, 30, t(99)), null, "unassigned → no SLA to answer for");

{
  // Still open, inside the allowance.
  const s = slaState(t(0), null, 30, t(18))!;
  assert.strictEqual(s.elapsedMinutes, 18);
  assert.strictEqual(s.breached, false);
  assert.strictEqual(s.remainingMinutes, 12);
}
{
  // Still open, past it.
  const s = slaState(t(0), null, 30, t(33))!;
  assert.strictEqual(s.elapsedMinutes, 33);
  assert.strictEqual(s.breached, true);
  assert.strictEqual(s.remainingMinutes, 0);
}
{
  // Paid: the clock stops at payout, not now — a request paid on time must not
  // drift into breach just because it's being viewed later.
  const s = slaState(t(0), t(20), 30, t(500))!;
  assert.strictEqual(s.elapsedMinutes, 20);
  assert.strictEqual(s.breached, false, "a payout made on time stays on time forever");
}
{
  const s = slaState(t(0), t(45), 30, t(500))!;
  assert.strictEqual(s.breached, true, "a late payout stays late forever");
}
{
  // Exactly on the line is not a breach; a hair over is.
  assert.strictEqual(slaState(t(0), t(30), 30, t(30))!.breached, false, "exactly on time is on time");
  const justOver = slaState(new Date(0), new Date(30 * 60_000 + 1), 30)!;
  assert.strictEqual(justOver.breached, true, "one second over is a breach");
  assert.strictEqual(justOver.elapsedMinutes, 30, "…but it still reads as 30 minutes elapsed");
}
{
  // Clock skew must not produce negative time.
  const s = slaState(t(10), t(5), 30, t(10))!;
  assert.strictEqual(s.elapsedMinutes, 0);
  assert.strictEqual(s.breached, false);
}
assert.strictEqual(minutesBetween(t(10), t(0)), 0, "never negative");

console.log("payoutRouting self-check passed");
