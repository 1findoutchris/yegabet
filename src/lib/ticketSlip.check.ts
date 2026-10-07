/*
 * Self-check for per-match results on tickets, using the real BetBy payloads
 * of ticket 41649 (a lost 3-leg combo: Greece lost, the other two still open).
 * Run: `npx tsx src/lib/ticketSlip.check.ts`
 */
import assert from "node:assert";
import { betPayout, betTotal, formatTotal, parseSlip, providerPayout, ticketTotal, withResults } from "./ticketSlip";

const leg = (team1: string, team2: string, pick: string, coeficient: number, outcome: number) => ({
  game_id: 1, team1, team2, sport: "Soccer", market_type_name: "1x2", outcome_display_name: pick,
  coeficient, start_ts: 1790880300, outcome, score1: null, score2: null, handicap: null, base: null,
});
const info = (bet_id: number, outcome: number, legOutcomes: [number, number, number]) =>
  JSON.stringify({
    method: "ChangeBalance",
    detail: JSON.stringify({
      bet_id, type: 0, amount: 20, k: 19.05498, outcome, legs: [
        leg("Denmark", "Portugal", "Denmark", 3.55, legOutcomes[0]),
        leg("Greece", "Netherlands", "Greece", 3.55, legOutcomes[1]),
        leg("Wales", "Norway", "Norway", 1.44, legOutcomes[2]),
      ],
    }),
  });

const placed = info(0, 0, [0, 0, 0]);   // at placement: every leg open
const decided = info(41649, 2, [0, 2, 0]); // settle callback: Greece lost

// ── placement payload alone: every match open ───────────────────────────────
{
  const slip = parseSlip(placed);
  assert.deepStrictEqual(slip.selections.map((s) => s.result), ["open", "open", "open"]);
  assert.deepStrictEqual(withResults(slip, null, false).map((s) => s.result), ["open", "open", "open"]);
}

// ── settle payload: each match gets its own result ──────────────────────────
{
  const out = withResults(parseSlip(placed), decided, true);
  assert.deepStrictEqual(out.map((s) => [s.match, s.result]), [
    ["Denmark - Portugal", "open"],
    ["Greece - Netherlands", "lost"],
    ["Wales - Norway", "open"],
  ]);
  assert.strictEqual(out[1].odds, "3.55", "odds still come from the placement");
}

// ── 1 = won; unknown codes get no mark rather than a guess ──────────────────
{
  const out = withResults(parseSlip(placed), info(41649, 1, [1, 3, 1]), true);
  assert.deepStrictEqual(out.map((s) => s.result), ["won", null, "won"]);
}

// ── settled with no settle payload: no stale "open" marks ───────────────────
{
  assert.deepStrictEqual(withResults(parseSlip(placed), null, true).map((s) => s.result), [null, null, null]);
}

// ── Total (possible payout) = stake × total odds ────────────────────────────
{
  assert.strictEqual(betTotal(100, "8.50"), 850, "the example: 100 ETB at 8.50");
  assert.strictEqual(betTotal("20", parseSlip(placed).totalOdds), 381.1, "20 × 19.05498, to the cent");
  assert.strictEqual(betTotal(100, null), null, "no odds → no total");
  assert.strictEqual(ticketTotal([{ betAmount: "20", info: placed }]), 381.1);
  assert.strictEqual(
    ticketTotal([{ betAmount: "20", info: placed }, { betAmount: "10", info: placed }]),
    571.65,
    "two bets: the totals add up",
  );
  assert.strictEqual(ticketTotal([{ betAmount: "20", info: placed }, { betAmount: "5", info: null }]), null,
    "one bet without odds → no ticket total rather than an understated one");
}

// ── Total: provider payout first, else stake × total odds ───────────────────
{
  // The user's example: 20 ETB at 346.88.
  const combo = JSON.stringify({ detail: JSON.stringify({ amount: 20, k: 346.88, legs: [{ team1: "A", team2: "B", coeficient: 346.88 }] }) });
  assert.strictEqual(providerPayout(combo), null, "BetBy sends no payout field");
  assert.strictEqual(betPayout({ betAmount: "20", info: combo }), 6937.6);
  assert.strictEqual(formatTotal(6937.6), "6,937.60");

  // A payout the provider sends wins over the multiplication — root or detail.
  const withPayout = JSON.stringify({ detail: JSON.stringify({ amount: 20, k: 346.88, potential_win: 6900, legs: [] }) });
  assert.strictEqual(betPayout({ betAmount: "20", info: withPayout }), 6900);
  assert.strictEqual(providerPayout({ possibleWin: "123.456" }), 123.46);

  // Settled win amounts are NOT a possible payout (0 while open/lost).
  assert.strictEqual(providerPayout({ winAmount: 500, totalWin: 500, win_amount: "500" }), null);
  assert.strictEqual(providerPayout({ payout: 0 }), null, "zero isn't a payout");
}
