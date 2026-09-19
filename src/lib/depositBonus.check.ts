/*
 * Self-check for deposit-bonus maths — it decides how much free money leaves
 * the platform per deposit, so the caps and the both-rules case get pinned.
 * Run: `npx tsx src/lib/depositBonus.check.ts`
 */
import assert from "node:assert";
import {
  quoteDepositBonus, reloadWindowOpen, type DepositBonusConfig,
} from "./depositBonusCore";

const cfg = (over: Partial<DepositBonusConfig> = {}): DepositBonusConfig => ({
  firstDeposit: { enabled: true, pct: 1, maxEtb: 1000, minDepositEtb: 50 },
  reload: { enabled: false, pct: 0.2, maxEtb: 500, minDepositEtb: 50, startsAt: "", endsAt: "" },
  ...over,
});

const NOW = new Date("2026-08-08T12:00:00.000Z");

// ── First-deposit rule ────────────────────────────────────────────────────────
assert.deepStrictEqual(quoteDepositBonus(500, true, cfg(), NOW), { amount: 500, rule: "firstDeposit" });

// Only ever fires on the first deposit.
assert.deepStrictEqual(quoteDepositBonus(500, false, cfg(), NOW), { amount: 0, rule: null });

// The cap binds — 100% of 5000 is 5000, but maxEtb is 1000.
assert.strictEqual(quoteDepositBonus(5000, true, cfg(), NOW).amount, 1000);

// Below the minimum earns nothing, at the minimum earns.
assert.strictEqual(quoteDepositBonus(49, true, cfg(), NOW).amount, 0);
assert.strictEqual(quoteDepositBonus(50, true, cfg(), NOW).amount, 50);

// Disabled pays nothing however large the deposit.
assert.strictEqual(
  quoteDepositBonus(9999, true, cfg({ firstDeposit: { enabled: false, pct: 1, maxEtb: 1000, minDepositEtb: 0 } }), NOW).amount,
  0,
);

// ── Reload / custom-% rule ────────────────────────────────────────────────────
const reloadOn = cfg({
  firstDeposit: { enabled: false, pct: 1, maxEtb: 1000, minDepositEtb: 50 },
  reload: { enabled: true, pct: 0.2, maxEtb: 500, minDepositEtb: 50, startsAt: "", endsAt: "" },
});
assert.deepStrictEqual(quoteDepositBonus(1000, false, reloadOn, NOW), { amount: 200, rule: "reload" });

// Unlike the welcome bonus, it pays on every deposit including the first.
assert.strictEqual(quoteDepositBonus(1000, true, reloadOn, NOW).amount, 200);

// Its own cap binds independently.
assert.strictEqual(quoteDepositBonus(100000, false, reloadOn, NOW).amount, 500);

// ── The window ────────────────────────────────────────────────────────────────
const windowed = (startsAt: string, endsAt: string) =>
  ({ enabled: true, pct: 0.2, maxEtb: 500, minDepositEtb: 0, startsAt, endsAt });

// Inside, on the first day, and on the last day (inclusive to end of day).
assert.ok(reloadWindowOpen(windowed("2026-08-01", "2026-08-31"), NOW));
assert.ok(reloadWindowOpen(windowed("2026-08-08", "2026-08-08"), NOW), "a one-day promo covers its whole day");
assert.ok(reloadWindowOpen(windowed("", ""), NOW), "no dates = the toggle alone decides");

// Outside on either side.
assert.ok(!reloadWindowOpen(windowed("2026-08-09", ""), NOW), "not started yet");
assert.ok(!reloadWindowOpen(windowed("", "2026-08-07"), NOW), "already finished");

// The toggle beats the window — a disabled promo never pays, dates or not.
assert.ok(!reloadWindowOpen({ ...windowed("2026-08-01", "2026-08-31"), enabled: false }, NOW));

// An expired window really stops the money.
assert.strictEqual(
  quoteDepositBonus(1000, false, cfg({ reload: windowed("2026-01-01", "2026-01-02") }), NOW).amount,
  0,
);

// ── Both rules live: BETTER of the two, never the sum ─────────────────────────
const bothOn = cfg({
  firstDeposit: { enabled: true, pct: 1, maxEtb: 1000, minDepositEtb: 50 },
  reload: { enabled: true, pct: 0.2, maxEtb: 500, minDepositEtb: 50, startsAt: "", endsAt: "" },
});
const both = quoteDepositBonus(1000, true, bothOn, NOW);
assert.strictEqual(both.amount, 1000, "1000 (100% welcome), not 1200 (welcome + reload)");
assert.strictEqual(both.rule, "firstDeposit");

// When the reload is the more generous of the two, it wins.
const generousReload = cfg({
  firstDeposit: { enabled: true, pct: 0.05, maxEtb: 1000, minDepositEtb: 0 },
  reload: { enabled: true, pct: 0.5, maxEtb: 1000, minDepositEtb: 0, startsAt: "", endsAt: "" },
});
assert.deepStrictEqual(quoteDepositBonus(1000, true, generousReload, NOW), { amount: 500, rule: "reload" });

// A repeat deposit during a promo still gets the reload.
assert.strictEqual(quoteDepositBonus(1000, false, bothOn, NOW).amount, 200);

// ── Degenerate input must never mint money ───────────────────────────────────
assert.deepStrictEqual(quoteDepositBonus(0, true, cfg(), NOW), { amount: 0, rule: null });
assert.deepStrictEqual(quoteDepositBonus(-500, true, cfg(), NOW), { amount: 0, rule: null });
assert.strictEqual(
  quoteDepositBonus(1000, true, cfg({ firstDeposit: { enabled: true, pct: 0, maxEtb: 1000, minDepositEtb: 0 } }), NOW).amount,
  0,
);
assert.strictEqual(
  quoteDepositBonus(1000, true, cfg({ firstDeposit: { enabled: true, pct: 1, maxEtb: 0, minDepositEtb: 0 } }), NOW).amount,
  0,
  "a zero cap disables the rule rather than paying uncapped",
);

// Rounding stays at 2dp — this figure becomes a Decimal(12,2).
assert.strictEqual(
  quoteDepositBonus(333.33, true, cfg({ firstDeposit: { enabled: true, pct: 0.333, maxEtb: 1000, minDepositEtb: 0 } }), NOW).amount,
  111,
);

console.log("depositBonus self-check passed");
