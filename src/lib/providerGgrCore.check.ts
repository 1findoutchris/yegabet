/*
 * Self-check for the Provider GGR arithmetic: the fee policies (including the
 * Silent API per-round rule carried over from the old Silent GGR page, which
 * was verified against Silent's own Game_Transactions export), rate history,
 * and date ranges.
 * Run: `npx tsx src/lib/providerGgrCore.check.ts`
 */
import assert from "node:assert";
import {
  addDays, daysBetween, providerTotals, rateFor, resolvePeriod, segmentFee, validRatePct,
  type AggRow, type RateRow,
} from "./providerGgrCore";

const rate = (o: Partial<RateRow> & Pick<RateRow, "providerKey" | "ratePct" | "effectiveFrom">): RateRow => ({
  id: `${o.providerKey}@${o.effectiveFrom}#${o.ratePct}`, policy: "net_floor", changedBy: "t", note: null,
  createdAt: "2026-01-01T00:00:00Z", ...o,
});
const row = (o: Partial<AggRow>): AggRow => ({
  integration: "octhera", gameId: "g", currency: "ETB", day: "2026-10-01", settled: true,
  bet: 0, win: 0, billable: 0, rounds: 1, voidedBet: 0, voidedRounds: 0, ...o,
});

// ── the worked example ──────────────────────────────────────────────────────
{
  const t = providerTotals(
    [row({ bet: 100000, win: 80000, billable: 20000 })],
    "octhera:x", [rate({ providerKey: "octhera:x", ratePct: 8, effectiveFrom: "2026-01-01" })], "2026-10-01",
  );
  assert.deepStrictEqual([t.totalBet, t.totalWin, t.ggr, t.fee, t.remaining], [100000, 80000, 20000, 1600, 18400]);
}

// ── negative GGR per policy ─────────────────────────────────────────────────
{
  const r = (policy: RateRow["policy"]) => rate({ providerKey: "k:x", ratePct: 10, effectiveFrom: "2000-01-01", policy });
  assert.strictEqual(segmentFee(r("net_floor"), -2000, 0), 0, "net_floor: nothing owed on a losing period");
  assert.strictEqual(segmentFee(r("net_credit"), -2000, 0), -200, "net_credit: a credit");
  assert.strictEqual(segmentFee(r("per_round"), -2000, 500), 50, "per_round: house-won rounds still billed");
  assert.strictEqual(segmentFee(null, 5000, 5000), 0, "no rate configured → no fee");
}

// ── Silent API's verified per-round rule (from the old ggr.check.ts) ────────
// 10% × max(bet − win, 0) per round; a player-won round is charged 0 and never
// offsets another. Over 22–24 Aug net GGR was −3,784.37 yet Silent deducted
// 15,197.36 — netting first is what made the old page read 0.00.
{
  const silent = [rate({ providerKey: "silent:*", ratePct: 10, effectiveFrom: "2000-01-01", policy: "per_round" })];
  const rounds = (r: [bet: number, win: number][]) =>
    r.map(([bet, win]) => row({ integration: "silent", bet, win, billable: Math.max(bet - win, 0) }));
  const fee = (r: [number, number][]) => providerTotals(rounds(r), "silent:x", silent, "2026-10-01").fee;
  assert.strictEqual(fee([[1, 0]]), 0.1, "loss");
  assert.strictEqual(fee([[1, 3.5]]), 0, "win");
  assert.strictEqual(fee([[2, 1.8]]), 0.02, "partial");
  assert.strictEqual(fee([[10, 5]]), 0.5, "partial");
  const losingPeriod = providerTotals(rounds([[1, 0], [1, 0], [1, 5]]), "silent:x", silent, "2026-10-01");
  assert.strictEqual(losingPeriod.ggr, -2);
  assert.strictEqual(losingPeriod.fee, 0.2, "billed despite negative GGR");
  assert.strictEqual(fee([[49, 49]]), 0, "a push is billed nothing");
}

// ── unsettled and voided never reach GGR or the fee ─────────────────────────
{
  const rates = [rate({ providerKey: "octhera:*", ratePct: 10, effectiveFrom: "2000-01-01" })];
  const t = providerTotals(
    [row({ bet: 100, win: 0, billable: 100 }), row({ settled: false, bet: 500, rounds: 2 }), row({ bet: 0, rounds: 0, voidedBet: 40, voidedRounds: 1 })],
    "octhera:x", rates, "2026-10-01",
  );
  assert.deepStrictEqual([t.totalBet, t.ggr, t.fee, t.unsettledBet, t.unsettledRounds, t.voidedBet], [100, 100, 10, 500, 2, 40]);
}

// ── rate history: each day at its own rate; provider beats integration ──────
{
  const rates = [
    rate({ providerKey: "octhera:*", ratePct: 5, effectiveFrom: "2026-01-01" }),
    rate({ providerKey: "octhera:x", ratePct: 8, effectiveFrom: "2026-10-02" }),
    rate({ providerKey: "octhera:x", ratePct: 12, effectiveFrom: "2026-10-03" }),
  ];
  assert.strictEqual(rateFor("octhera:x", "2026-10-01", rates)!.ratePct, 5, "before its own rate: integration default");
  assert.strictEqual(rateFor("octhera:x", "2026-10-02", rates)!.ratePct, 8);
  assert.strictEqual(rateFor("octhera:x", "2026-10-09", rates)!.ratePct, 12);
  assert.strictEqual(rateFor("octhera:y", "2026-10-09", rates)!.ratePct, 5, "other providers keep the default");
  assert.strictEqual(rateFor("silent:y", "2026-10-09", rates), null, "other integrations unaffected");

  const t = providerTotals(
    ["2026-10-01", "2026-10-02", "2026-10-03"].map((day) => row({ day, bet: 1000, billable: 1000 })),
    "octhera:x", rates, "2026-10-03",
  );
  assert.strictEqual(t.fee, 50 + 80 + 120, "each day at the rate in force that day");
  assert.strictEqual(t.mixedRates, true);
  assert.strictEqual(t.rate!.ratePct, 12, "current = last day's");

  // Same effective date twice: the later entry wins (a correction).
  const fixed = [...rates, { ...rate({ providerKey: "octhera:x", ratePct: 9, effectiveFrom: "2026-10-03" }), id: "fix", createdAt: "2026-10-03T10:00:00Z" }];
  assert.strictEqual(rateFor("octhera:x", "2026-10-03", fixed)!.ratePct, 9);
}

// ── net policies net within each rate's stretch, not across ─────────────────
{
  const rates = [
    rate({ providerKey: "k:x", ratePct: 10, effectiveFrom: "2026-10-01" }),
    rate({ providerKey: "k:x", ratePct: 10, effectiveFrom: "2026-10-02" }),
  ];
  const t = providerTotals(
    [row({ day: "2026-10-01", bet: 0, win: 500 }), row({ day: "2026-10-02", bet: 1000, win: 0 })],
    "k:x", rates, "2026-10-02",
  );
  assert.strictEqual(t.fee, 100, "the losing stretch under the old version doesn't offset the new one");
}

// ── validation ──────────────────────────────────────────────────────────────
for (const ok of [0, 8, 12.5, 100, 7.25]) assert.ok(validRatePct(ok), String(ok));
for (const bad of [-1, 100.01, 8.123, NaN, Infinity, "8"]) assert.ok(!validRatePct(bad), String(bad));

// ── periods (report timezone already applied: `today` is a local date) ──────
{
  const today = "2026-10-08"; // a Thursday
  assert.deepStrictEqual(resolvePeriod("today", today), { period: "today", fromDay: today, toDay: today });
  assert.deepStrictEqual(resolvePeriod("yesterday", today), { period: "yesterday", fromDay: "2026-10-07", toDay: "2026-10-07" });
  assert.deepStrictEqual(resolvePeriod("week", today), { period: "week", fromDay: "2026-10-04", toDay: today }, "weeks start Sunday");
  assert.deepStrictEqual(resolvePeriod("month", today), { period: "month", fromDay: "2026-10-01", toDay: today });
  assert.deepStrictEqual(resolvePeriod("custom", today, "2026-09-01", "2026-09-30"), { period: "custom", fromDay: "2026-09-01", toDay: "2026-09-30" });
  assert.strictEqual(resolvePeriod("custom", today, "2026-09-30", "2026-09-01"), null, "reversed");
  assert.strictEqual(resolvePeriod("custom", today, "2024-01-01", "2026-09-01"), null, "too long");
  assert.strictEqual(resolvePeriod("custom", today, "bad", "2026-09-01"), null);
  assert.strictEqual(resolvePeriod("forever", today), null);
  assert.strictEqual(addDays("2026-03-01", -1), "2026-02-28");
  assert.deepStrictEqual(daysBetween("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
}
