// Provider GGR — the pure arithmetic, split out of providerGgr.ts so every rule
// is testable without a database (same shape as ggr/otp/ads cores).
//
// Vocabulary
//   round        one game round / sportsbook bet, folded from its callbacks
//   Total Bet    stakes of rounds that weren't voided (rolled back)
//   Total Win    what those rounds paid back — wins plus refunded stakes
//   GGR          Total Bet − Total Win; negative when players won more
//   settled      the round has a settlement event (a payout, a close/settle
//                callback, round_finished), or is a casino round older than a
//                day. Fees are charged on settled rounds only; unsettled
//                stakes (open sportsbook bets) are reported apart.

/** How a provider's agreement treats a period where players won (GGR < 0). */
export type NegativePolicy =
  /** Fee on the period's net GGR; nothing is owed either way when it's negative. */
  | "net_floor"
  /** Fee on the period's net GGR; a negative GGR is a credit (negative fee). */
  | "net_credit"
  /** Fee on each round the house won (max(bet − win, 0)); a player-won round
   *  is charged 0 and never offsets another. Silent API's billing, verified
   *  against their Game_Transactions export. */
  | "per_round";

export const NEGATIVE_POLICIES: { id: NegativePolicy; label: string }[] = [
  { id: "net_floor", label: "Net GGR — no fee when negative" },
  { id: "net_credit", label: "Net GGR — negative becomes a credit" },
  { id: "per_round", label: "Per round — house-won rounds only" },
];

export function isNegativePolicy(v: unknown): v is NegativePolicy {
  return v === "net_floor" || v === "net_credit" || v === "per_round";
}

/** One version of a provider's fee. Rows are never edited, only added. */
export type RateRow = {
  id: string;
  /** "octhera:pragmatic", or "octhera:*" for every provider of an integration. */
  providerKey: string;
  ratePct: number;
  policy: NegativePolicy;
  /** First day (YYYY-MM-DD, report timezone) the rate applies to. */
  effectiveFrom: string;
  changedBy: string;
  note: string | null;
  createdAt: string;
};

export const integrationOf = (providerKey: string) => providerKey.slice(0, providerKey.indexOf(":"));
export const wildcardKey = (integration: string) => `${integration}:*`;

/**
 * The rate in force for `providerKey` on `day`: the provider's own latest
 * version effective on or before that day, else the integration-wide one.
 * Among versions with the same effective date, the newest entry wins.
 */
export function rateFor(providerKey: string, day: string, rates: RateRow[]): RateRow | null {
  const pick = (key: string) => {
    let best: RateRow | null = null;
    for (const r of rates) {
      if (r.providerKey !== key || r.effectiveFrom > day) continue;
      if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.createdAt > best.createdAt)) {
        best = r;
      }
    }
    return best;
  };
  return pick(providerKey) ?? pick(wildcardKey(integrationOf(providerKey)));
}

/**
 * The SQL's output: one row per (integration, game, currency, day, settled).
 * `billable` is Σ max(bet − win, 0) over the rounds in the row, which only
 * the per-round policy uses.
 */
export type AggRow = {
  integration: string;
  gameId: string | null;
  currency: string;
  day: string;
  settled: boolean;
  bet: number;
  win: number;
  billable: number;
  rounds: number;
  voidedBet: number;
  voidedRounds: number;
};

export type Totals = {
  totalBet: number;
  totalWin: number;
  ggr: number;
  fee: number;
  remaining: number;
  rounds: number;
  /** Rounds still waiting for a result — not in the figures above. */
  unsettledBet: number;
  unsettledRounds: number;
  /** Rounds the provider rolled back — excluded everywhere. */
  voidedBet: number;
  voidedRounds: number;
  /** The rate on the last day of the range (null = none configured). */
  rate: RateRow | null;
  /** More than one rate version applied inside the range. */
  mixedRates: boolean;
  /** Settled GGR with no rate configured for some day — fee counted as 0 there. */
  unratedGgr: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totals for ONE provider in ONE currency over a range of days.
 *
 * The fee is worked out per rate version: the range is split where the rate
 * changes, each part is charged at its own version's percentage and policy,
 * and the parts are added. So changing a rate today never alters yesterday,
 * and a net policy nets within each version's stretch of the range.
 */
export function providerTotals(rows: AggRow[], providerKey: string, rates: RateRow[], lastDay: string): Totals {
  const settled = rows.filter((r) => r.settled);
  const open = rows.filter((r) => !r.settled);

  type Seg = { rate: RateRow | null; bet: number; win: number; billable: number };
  const segs = new Map<string, Seg>();
  for (const r of settled) {
    const rate = rateFor(providerKey, r.day, rates);
    const key = rate?.id ?? "none";
    const s = segs.get(key) ?? { rate, bet: 0, win: 0, billable: 0 };
    s.bet += r.bet;
    s.win += r.win;
    s.billable += r.billable;
    segs.set(key, s);
  }

  let fee = 0;
  let unratedGgr = 0;
  for (const s of segs.values()) fee += segmentFee(s.rate, s.bet - s.win, s.billable);
  for (const s of segs.values()) if (!s.rate) unratedGgr += s.bet - s.win;

  const totalBet = sum(settled, "bet");
  const totalWin = sum(settled, "win");
  const ggr = totalBet - totalWin;
  return {
    totalBet: r2(totalBet),
    totalWin: r2(totalWin),
    ggr: r2(ggr),
    fee: r2(fee),
    remaining: r2(ggr - fee),
    rounds: sum(settled, "rounds"),
    unsettledBet: r2(sum(open, "bet")),
    unsettledRounds: sum(open, "rounds"),
    voidedBet: r2(sum(rows, "voidedBet")),
    voidedRounds: sum(rows, "voidedRounds"),
    rate: rateFor(providerKey, lastDay, rates),
    mixedRates: [...segs.values()].filter((s) => s.rate).length > 1,
    unratedGgr: r2(unratedGgr),
  };
}

/** The fee on one stretch of settled play under one rate version. */
export function segmentFee(rate: RateRow | null, netGgr: number, billable: number): number {
  if (!rate) return 0;
  const pct = rate.ratePct / 100;
  switch (rate.policy) {
    case "per_round":
      return billable * pct;
    case "net_credit":
      return netGgr * pct;
    case "net_floor":
    default:
      return Math.max(netGgr, 0) * pct;
  }
}

function sum<K extends "bet" | "win" | "billable" | "rounds" | "voidedBet" | "voidedRounds">(rows: AggRow[], k: K): number {
  return rows.reduce((s, r) => s + r[k], 0);
}

// ── rate validation ─────────────────────────────────────────────────────────

/** A percentage between 0 and 100 with at most two decimals. */
export function validRatePct(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 &&
    Math.abs(v * 100 - Math.round(v * 100)) < 1e-9
  );
}

/** Provider keys are "<integration>:<code>" or "<integration>:*". */
export const PROVIDER_KEY = /^(silent|gregmorn|octhera):([a-z0-9][a-z0-9_.-]{0,63}|\*)$/;

// ── date ranges ─────────────────────────────────────────────────────────────

export type Period = "today" | "yesterday" | "week" | "month" | "custom";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of `now` in `timeZone`. */
export function dayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Calendar arithmetic on YYYY-MM-DD, timezone-free. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MAX_CUSTOM_DAYS = 400;

/**
 * Inclusive [fromDay, toDay] for a period, in the report timezone. Weeks start
 * on Sunday, like the rest of the admin reports. Null for an invalid custom
 * range (bad dates, reversed, or over ~13 months).
 */
export function resolvePeriod(
  period: string,
  today: string,
  from?: string | null,
  to?: string | null,
): { period: Period; fromDay: string; toDay: string } | null {
  switch (period) {
    case "today":
      return { period, fromDay: today, toDay: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { period, fromDay: y, toDay: y };
    }
    case "week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      return { period, fromDay: addDays(today, -dow), toDay: today };
    }
    case "month":
      return { period, fromDay: `${today.slice(0, 8)}01`, toDay: today };
    case "custom": {
      if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return null;
      if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
      const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (span > MAX_CUSTOM_DAYS) return null;
      return { period, fromDay: from, toDay: to };
    }
    default:
      return null;
  }
}

export function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push(d);
  return out;
}
