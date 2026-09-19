/*
 * Self-check for the GGR split — it decides what the admin panel says we owe the
 * provider, so the 10% rate, the per-round (never netted) base, and the round
 * netting the route's SQL does before any of it all get pinned.
 * Run: `npx tsx src/lib/ggr.check.ts`
 */
import assert from "node:assert";
import { ggrSplit, sumBuckets, SILENT_GGR_RATE, GgrBucket } from "./ggr";

assert.strictEqual(SILENT_GGR_RATE, 0.1);

/**
 * What the route's SQL builds: callbacks folded into rounds, then billed. Each
 * inner array is one round, each pair one callback as [bet, win].
 */
const rounds = (r: Array<Array<[bet: number, win: number]>>): GgrBucket => ({
  staked: r.flat().reduce((s, [b]) => s + b, 0),
  payout: r.flat().reduce((s, [, w]) => s + w, 0),
  billable: r.reduce((s, legs) => {
    const bet = legs.reduce((a, [b]) => a + b, 0);
    const win = legs.reduce((a, [, w]) => a + w, 0);
    return s + Math.max(bet - win, 0);
  }, 0),
  rounds: r.length,
});

// Rows straight off Silent API's Game_Transactions export. Their "GGR Deducted"
// column is reproduced exactly by 10% x max(bet - win, 0), including partial
// wins — 39,323 rounds checked, zero mismatches.
assert.strictEqual(ggrSplit(rounds([[[1, 0], [0, 0]]])).silentCut, 0.1); // LOSS
assert.strictEqual(ggrSplit(rounds([[[1, 0], [0, 3.5]]])).silentCut, 0); // WIN
assert.strictEqual(ggrSplit(rounds([[[2, 0], [0, 1.8]]])).silentCut, 0.02); // partial
assert.strictEqual(ggrSplit(rounds([[[10, 0], [0, 5]]])).silentCut, 0.5); // partial

// The whole point: a winning round is charged 0, not credited, so it cannot pay
// down a losing one. Their export bills 15,197.36 over a window our GGR came out
// of at −3,784.37, and netting first is what made this page read 0.00.
const losingPeriod = rounds([
  [[1, 0], [0, 0]],
  [[1, 0], [0, 0]],
  [[1, 0], [0, 5], [0, 0]],
]);
assert.strictEqual(ggrSplit(losingPeriod).ggr, -2);
assert.strictEqual(ggrSplit(losingPeriod).billable, 2);
assert.strictEqual(ggrSplit(losingPeriod).silentCut, 0.2);

// A round is several callbacks. Read per callback instead of per round and the
// stake leg of a won round looks like a house win — that bug billed 10% of gross
// turnover, so pin the difference.
const won = rounds([[[1, 0], [0, 2.5], [0, 0]]]);
assert.strictEqual(won.rounds, 1);
assert.strictEqual(won.staked, 1);
assert.strictEqual(won.payout, 2.5);
assert.strictEqual(ggrSplit(won).ggr, -1.5);
assert.strictEqual(ggrSplit(won).silentCut, 0);

// A push (bet == win, the 0.00 rows) is a round, billed nothing.
const push = ggrSplit(rounds([[[49, 49]]]));
assert.strictEqual(push.ggr, 0);
assert.strictEqual(push.silentCut, 0);
assert.strictEqual(push.rounds, 1);

// Empty period is zero, not NaN.
assert.deepStrictEqual(ggrSplit({ staked: 0, payout: 0, billable: 0, rounds: 0 }), {
  staked: 0, payout: 0, billable: 0, rounds: 0, ggr: 0, silentCut: 0,
});

// Per-round means additive: summing day buckets then splitting has to equal
// splitting each day then adding, which is what lets the table's Total row tie.
const days = [
  rounds([[[100, 0]], [[50, 0], [0, 80]]]),
  rounds([[[20, 0], [0, 5]]]),
  rounds([[[7, 7]]]),
];
const total = ggrSplit(sumBuckets(days));
const addedUp = days.reduce((s, d) => s + ggrSplit(d).silentCut, 0);
assert.strictEqual(total.silentCut, Math.round(addedUp * 100) / 100);
assert.strictEqual(total.rounds, 4);
assert.strictEqual(total.silentCut, 11.5); // 10% of (100 + 0 + 15 + 0)
assert.deepStrictEqual(sumBuckets([]), { staked: 0, payout: 0, billable: 0, rounds: 0 });

// Float noise from SUM()::float8 gets rounded to cents.
const cents = ggrSplit(rounds([[[33.33, 0], [0, 11.11]]]));
assert.strictEqual(cents.ggr, 22.22);
assert.strictEqual(cents.silentCut, 2.22);

console.log("ggr.check.ts OK");
