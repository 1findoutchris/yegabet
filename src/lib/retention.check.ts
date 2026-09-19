/*
 * Self-check for the daily challenge rotation.
 * Run: `npm test` — not bare tsx like the other checks, because the day-key
 * asserts import loyalty.ts, which is `server-only`.
 *
 * The rotation is what makes the daily card need no cron and no stored "today's
 * set": it must be a pure function of the day number, stable within a day, and
 * different tomorrow.
 */
import assert from "node:assert";
import { pickDailyChallenges, DAILY_CHALLENGES, DAILY_CHALLENGE_COUNT, type Challenge } from "./retention";
import { utcDayKey, utcDayStart } from "./loyalty";

const pool = (n: number): Challenge[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, title: `Challenge ${i}`, segment: "All players",
    metric: "wager" as const, target: 100, unit: "ETB", points: 10,
  }));

const ids = (list: Challenge[]) => list.map((c) => c.id).join(",");

// ── the set is stable within a day and moves on the next ─────────────────────
{
  const p = pool(8);
  assert.strictEqual(ids(pickDailyChallenges(p, 100)), ids(pickDailyChallenges(p, 100)),
    "same day must give the same set — it is read on every page load");
  assert.notStrictEqual(ids(pickDailyChallenges(p, 100)), ids(pickDailyChallenges(p, 101)),
    "tomorrow must differ, or the card never changes");
}

// ── always the right number, never a duplicate inside one day ────────────────
{
  const p = pool(8);
  for (let day = 0; day < 400; day++) {
    const today = pickDailyChallenges(p, day);
    assert.strictEqual(today.length, DAILY_CHALLENGE_COUNT, `day ${day}: wrong count`);
    assert.strictEqual(new Set(today.map((c) => c.id)).size, today.length,
      `day ${day}: the same challenge appeared twice`);
    for (const c of today) {
      assert.ok(p.some((x) => x.id === c.id), `day ${day}: returned something outside the pool`);
    }
  }
}

// ── a pool no bigger than the daily count is shown whole ─────────────────────
{
  assert.strictEqual(ids(pickDailyChallenges(pool(3), 5)), "c0,c1,c2", "exactly enough → show all");
  assert.strictEqual(ids(pickDailyChallenges(pool(2), 5)), "c0,c1", "too few → show what there is");
  assert.deepStrictEqual(pickDailyChallenges([], 5), [], "an empty pool must not throw");
}

// ── every challenge in the pool eventually gets shown ────────────────────────
{
  const p = pool(8);
  const seen = new Set<string>();
  for (let day = 0; day < 30; day++) pickDailyChallenges(p, day).forEach((c) => seen.add(c.id));
  assert.strictEqual(seen.size, p.length, "some challenges could never appear");
}

// ── a clock before 1970 must still land inside the pool ──────────────────────
{
  const today = pickDailyChallenges(pool(8), -3);
  assert.strictEqual(today.length, DAILY_CHALLENGE_COUNT);
  assert.ok(today.every(Boolean), "negative day index read off the front of the pool");
}

// ── the shipped pool is usable ───────────────────────────────────────────────
{
  assert.ok(DAILY_CHALLENGES.length > DAILY_CHALLENGE_COUNT,
    "a pool no bigger than the daily count would show the same card every day");
  assert.strictEqual(new Set(DAILY_CHALLENGES.map((c) => c.id)).size, DAILY_CHALLENGES.length,
    "duplicate id — claims are keyed by id, so two rows would share one claim");
  assert.ok(DAILY_CHALLENGES.every((c) => c.target > 0 && c.points > 0),
    "a challenge with no target or no points is not a challenge");
}

// ── the day key is distinct from a week key, so claims can't collide ─────────
{
  const day = new Date(Date.UTC(2026, 7, 10, 23, 59, 59));
  assert.strictEqual(utcDayKey(day), "2026-08-10");
  assert.strictEqual(utcDayStart(day).toISOString(), "2026-08-10T00:00:00.000Z",
    "progress must count from midnight UTC, not from now");
  assert.ok(!utcDayKey(day).includes("W"), "must never look like an ISO week key");
}

console.log("retention self-check passed");
