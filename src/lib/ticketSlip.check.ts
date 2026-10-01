/*
 * Self-check for the "Bet this ticket" comparison — template legs vs what the
 * agent actually placed on the copy.
 * Run: `npx tsx src/lib/ticketSlip.check.ts`
 */
import assert from "node:assert";
import { compareRebet, parseSlip, templateSelections } from "./ticketSlip";

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const future = Math.floor((NOW + 3600_000) / 1000);
const past = Math.floor((NOW - 3600_000) / 1000);

// Real Gregmorn/BetBy shape: info is a JSON string whose `detail` is another JSON string.
const bet = (legs: Record<string, unknown>[], k = 1) => ({
  info: JSON.stringify({ detail: JSON.stringify({ legs, k }) }),
});
const leg = (team1: string, team2: string, market: string, outcome: string, coeficient: number, start_ts = future) =>
  ({ team1, team2, market_type_name: market, outcome_display_name: outcome, coeficient, start_ts, handicap: null, base: null });

const MU = leg("Manchester United", "Chelsea", "1x2", "Manchester United", 1.85);
const ARS = leg("Arsenal", "Liverpool", "Total", "over 2.5", 1.9);
const BAR = leg("Barcelona", "Real Madrid", "Both teams to score", "Yes", 1.7, past);
const original = [bet([MU, ARS, BAR], 5.98)];

// ── parsing keeps the raw kickoff for the started check ─────────────────────
{
  const s = parseSlip(original[0].info).selections;
  assert.strictEqual(s.length, 3);
  assert.strictEqual(s[0].match, "Manchester United - Chelsea");
  assert.strictEqual(s[0].marketPick, "1x2 Manchester United");
  assert.strictEqual(s[0].startsAt, future * 1000);
}

// ── nothing placed yet: future legs pending, kicked-off legs started ────────
{
  const c = compareRebet(original, [], NOW);
  assert.deepStrictEqual(c.legs.map((l) => l.state), ["pending", "pending", "started"]);
  assert.strictEqual(c.extraPlaced, 0);
  assert.ok(c.legs.every((l) => l.newOdds === null), "no new odds before anything is placed");
}

// ── placed: same odds ✅, moved odds ⚠️ with old → new, skipped leg stays ──
{
  const placed = [bet([MU, { ...ARS, coeficient: 2.05 }], 3.79)];
  const c = compareRebet(original, placed, NOW);
  assert.deepStrictEqual(c.legs.map((l) => l.state), ["placed", "odds_changed", "started"]);
  assert.strictEqual(c.legs[1].oldOdds, "1.9");
  assert.strictEqual(c.legs[1].newOdds, "2.05");
}

// ── matching ignores case/spacing; numeric odds compare by value ────────────
{
  const placed = [bet([{ ...MU, team1: "manchester  united", coeficient: "1.850" }])];
  assert.strictEqual(compareRebet(original, placed, NOW).legs[0].state, "placed");
}

// ── a leg added that wasn't on the original is counted, not matched ─────────
{
  const placed = [bet([MU, leg("Inter", "Milan", "1x2", "Draw", 3.2)])];
  assert.strictEqual(compareRebet(original, placed, NOW).extraPlaced, 1);
}

// ── duplicate selections across the original's bets are merged once ────────
{
  const dup = [bet([MU]), bet([MU, ARS])];
  const t = templateSelections(dup);
  assert.strictEqual(t.legs.length, 2);
  assert.strictEqual(t.duplicatesMerged, 1);
}

// ── unknown kickoff can't be proven started, so it stays pending ────────────
{
  const noTime = [bet([{ ...MU, start_ts: null }])];
  assert.strictEqual(compareRebet(noTime, [], NOW).legs[0].state, "pending");
}

// ── an unparseable payload yields no template at all ────────────────────────
{
  assert.strictEqual(templateSelections([{ info: "not json" }, { info: null }]).legs.length, 0);
}
