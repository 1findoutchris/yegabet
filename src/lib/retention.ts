/**
 * Retention & Engagement data layer.
 *
 * Encodes the rules from the BetPlatform Pro "User Retention & Engagement"
 * spec (loyalty ranks, bonuses, streaks, challenges, achievements,
 * leaderboards, VIP, casino mechanics).
 *
 * This module is client-safe (no `fs`, no `server-only`) so both server and
 * client components can import it. Amounts are expressed in ETB to match the
 * platform; percentages / thresholds follow the spec.
 */

// ── Loyalty & Ranking ─────────────────────────────────────────────────────

export type TierId = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "vip";

export interface Tier {
  id: TierId;
  name: string;
  /** Inclusive lower bound of the tier's points range. */
  min: number;
  /** Inclusive upper bound; null = open-ended (VIP). */
  max: number | null;
  /** Weekly cashback on net losses — display copy, e.g. "6%". */
  cashback: string;
  /** Weekly cashback as a numeric rate, e.g. 0.06 — used to credit real cashback. */
  cashbackRate: number;
  /** Maximum cashback payable per week (ETB) at this tier. */
  cashbackCap: number;
  /** Accent color for the tier's visual identity. */
  color: string;
  /** Path to the tier badge artwork in /public. */
  badge: string;
}

export const TIERS: Tier[] = [
  { id: "bronze",   name: "Bronze",   min: 0,      max: 999,    cashback: "2%",  cashbackRate: 0.02, cashbackCap: 100,  color: "#CD7F32", badge: "/badges/bronze.svg"   },
  { id: "silver",   name: "Silver",   min: 1000,   max: 4999,   cashback: "4%",  cashbackRate: 0.04, cashbackCap: 250,  color: "#C7CCD1", badge: "/badges/silver.svg"   },
  { id: "gold",     name: "Gold",     min: 5000,   max: 14999,  cashback: "6%",  cashbackRate: 0.06, cashbackCap: 500,  color: "#F0A500", badge: "/badges/gold.svg"     },
  { id: "platinum", name: "Platinum", min: 15000,  max: 39999,  cashback: "8%",  cashbackRate: 0.08, cashbackCap: 1000, color: "#9FE7E3", badge: "/badges/platinum.svg" },
  { id: "diamond",  name: "Diamond",  min: 40000,  max: 99999,  cashback: "10%", cashbackRate: 0.10, cashbackCap: 1500, color: "#7DE8D8", badge: "/badges/diamond.svg"  },
  { id: "vip",      name: "VIP",      min: 100000, max: null,   cashback: "15%", cashbackRate: 0.15, cashbackCap: 2000, color: "#D8B4FF", badge: "/badges/vip.svg" },
];

// ── Loyalty point economy (lifetime XP — points only ever go up) ───────────
export const POINTS_PER_ETB_WAGERED = 1;      // casino stake → points
export const WIN_BONUS_PCT = 0.25;            // +25% of win amount as bonus points
export const DAILY_PLAY_POINTS = 10;          // first real bet of a new day
export const FIRST_DEPOSIT_OF_WEEK_POINTS = 50; // first deposit each ISO week
export const MIN_STREAK_BET = 50;             // min ETB stake that counts for the streak

// ── Points redemption (spendable points → bonus credit) ───────────────────
/** Points that buy ETB 1 of bonus funds. At 1 pt/ETB wagered this is the
 *  effective rakeback rate — 50 means 2% of turnover. Tune from the admin
 *  rewards panel; it stacks on top of weekly cashback. */
export const POINTS_PER_ETB = 50;
/** Floor per redemption, in points. Also the step: a redemption must be an
 *  exact multiple of POINTS_PER_ETB so the ETB payout never needs rounding. */
export const MIN_REDEEM_POINTS = 500;

export interface RedemptionQuote {
  /** Points to spend. */
  points: number;
  /** ETB of bonus funds they buy. */
  etb: number;
}

/**
 * Validate and price a points redemption. Pure, and lives in this client-safe
 * module so the redeem route and the redeem UI enforce exactly the same rule —
 * the button greys out for the same reason the server would reject it.
 *
 * Requiring an exact multiple of `pointsPerEtb` is what keeps `etb` an exact
 * quotient, so no rounding is ever needed on the payout.
 */
export function quoteRedemption(
  points: number,
  available: number,
  pointsPerEtb: number,
  minRedeemPoints: number,
): { ok: true; quote: RedemptionQuote } | { ok: false; error: string } {
  if (!Number.isInteger(points) || points <= 0) {
    return { ok: false, error: "Enter a whole number of points" };
  }
  if (points < minRedeemPoints) {
    return { ok: false, error: `Minimum redemption is ${minRedeemPoints.toLocaleString()} points` };
  }
  if (points % pointsPerEtb !== 0) {
    return { ok: false, error: `Redeem in multiples of ${pointsPerEtb} points` };
  }
  if (points > available) {
    return { ok: false, error: "Not enough points" };
  }
  return { ok: true, quote: { points, etb: points / pointsPerEtb } };
}

/** Most points the user can actually spend — their balance rounded down to a
 *  whole multiple of `pointsPerEtb`. 0 when they're below the minimum. */
export function maxRedeemablePoints(
  available: number,
  pointsPerEtb: number,
  minRedeemPoints: number,
): number {
  const usable = Math.floor(available / pointsPerEtb) * pointsPerEtb;
  return usable >= minRedeemPoints ? usable : 0;
}

/** The tier a points total currently sits in (single source of truth = points).
 *  `tiers` defaults to the built-in ladder; server callers pass the
 *  admin-configured ladder from getRewardConfig(). */
export function tierForPoints(points: number, tiers: Tier[] = TIERS): Tier {
  return tiers.reduce((acc, t) => (points >= t.min ? t : acc), tiers[0]);
}

export interface RankState {
  tier: Tier;
  /** The tier ahead — null once the user is VIP. */
  nextTier: Tier | null;
  points: number;
  /** Points still needed to reach the next tier. */
  pointsToNext: number;
  /** 0–100 progress through the CURRENT tier toward the next. */
  progressPct: number;
  /** Estimated days to next tier from a 30-day average. */
  estDaysToNext: number | null;
}

/**
 * Compute rank state from a points total.
 *
 * Design principle from the spec: only ever surface the NEXT rank ahead —
 * never how far the user is from a rank they already passed.
 */
export function getRankState(points: number, avgPerDay = 0, tiers: Tier[] = TIERS): RankState {
  const idx = tiers.reduce((acc, t, i) => (points >= t.min ? i : acc), 0);
  const tier = tiers[idx];
  const nextTier = tiers[idx + 1] ?? null;

  if (!nextTier) {
    return { tier, nextTier: null, points, pointsToNext: 0, progressPct: 100, estDaysToNext: null };
  }

  const span = nextTier.min - tier.min;
  const into = points - tier.min;
  const pointsToNext = Math.max(0, nextTier.min - points);
  const progressPct = Math.min(100, Math.round((into / span) * 100));
  const estDaysToNext = avgPerDay > 0 ? Math.ceil(pointsToNext / avgPerDay) : null;

  return { tier, nextTier, points, pointsToNext, progressPct, estDaysToNext };
}

export const POINTS_RULES: { label: string; value: string }[] = [
  { label: "Casino bet placed",         value: "1 pt / ETB 1 wagered" },
  { label: "Casino win",                value: "+25% of win as points" },
  { label: "Play once a day",           value: "+10 pts" },
  { label: "First deposit of the week", value: "+50 pts" },
];

// ── Engagement profile (seeded demo state) ─────────────────────────────────

export interface EngagementProfile {
  username: string;
  points: number;
  avgPointsPerDay: number;
  streakDays: number;
  streakShields: number;
  weeklyDepositMade: boolean;
}

/** A realistic seeded profile so the UI is fully populated for any viewer. */
export const DEMO_PROFILE: EngagementProfile = {
  username: "habesha_07",
  points: 6240,
  avgPointsPerDay: 210,
  streakDays: 12,
  streakShields: 1,
  weeklyDepositMade: true,
};

// ── Bonuses & Rewards ──────────────────────────────────────────────────────

export interface OfferCard {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  meta: string;
  cta: string;
  href: string;
}

// Real, house-safe offers — each links to a feature that actually exists.
export const AVAILABLE_OFFERS: OfferCard[] = [
  { id: "cashback", emoji: "💸", title: "Weekly Cashback",      desc: "Get a slice of your net losses back as bonus every week — scales with your tier.", meta: "Up to 15% · bonus funds", cta: "Claim above",      href: "/rewards/bonuses" },
  { id: "streak",   emoji: "🔥", title: "Daily Streak Rewards", desc: "Play once a day to build a streak and claim escalating point + bonus milestones.", meta: "Up to 1,000 pts + ETB 1,000",     cta: "Open streak",      href: "/rewards/streak" },
  { id: "tiers",    emoji: "👑", title: "Climb the Tiers",      desc: "Earn points on every bet to reach higher tiers and unlock richer weekly cashback.", meta: "Bronze → VIP",                    cta: "View your rank",   href: "/rewards" },
  { id: "redeem",   emoji: "✨", title: "Redeem Points",        desc: "Turn the points you earn on every bet into bonus funds. Spending never costs you your tier.", meta: "50 pts = ETB 1 · bonus funds", cta: "Redeem now", href: "/rewards/bonuses" },
];

// ── Streaks & Achievements ─────────────────────────────────────────────────

export interface StreakMilestone {
  day: number;
  /** Loyalty points granted on claim. */
  points: number;
  /** ETB credited to balance on claim (0 = none). */
  etb: number;
  /** Display copy for the reward. */
  reward: string;
}

// Claimable once per streak cycle — rewards escalate with consecutive play days.
export const STREAK_MILESTONES: StreakMilestone[] = [
  { day: 3,   points: 25,   etb: 0,    reward: "25 points" },
  { day: 7,   points: 50,   etb: 50,   reward: "50 points + ETB 50 bonus" },
  { day: 14,  points: 100,  etb: 100,  reward: "100 points + ETB 100 bonus" },
  { day: 30,  points: 250,  etb: 250,  reward: "250 points + ETB 250 bonus" },
  { day: 60,  points: 500,  etb: 500,  reward: "500 points + ETB 500 bonus" },
  { day: 100, points: 1000, etb: 1000, reward: "1,000 points + ETB 1,000 bonus" },
];

/**
 * Visual intensity tier for the streak flame, by current streak length.
 * 0 = inactive (grey), rising to 5 = inferno. Aligned to the milestone days.
 */
export function streakFlameTier(days: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (days <= 0) return 0;
  if (days < 3) return 1;
  if (days < 7) return 2;
  if (days < 14) return 3;
  if (days < 30) return 4;
  return 5;
}

/** What a weekly challenge measures, computed from this ISO week's activity. */
export type ChallengeMetric = "wager" | "bets" | "deposit";

export interface Challenge {
  id: string;
  title: string;
  segment: string;
  metric: ChallengeMetric;
  target: number;
  unit: string;
  /** Loyalty points awarded on claim (house-safe — no cash cost). */
  points: number;
}

/** Weekly challenges (reset Monday 00:00 UTC). Rewards are points only. */
export const WEEKLY_CHALLENGES: Challenge[] = [
  { id: "wager",   title: "Wager ETB 2,500 on casino this week", segment: "Casino players", metric: "wager",   target: 2500, unit: "ETB",  points: 150 },
  { id: "bets",    title: "Play 20 casino rounds this week",     segment: "Active players", metric: "bets",    target: 20,   unit: "bets", points: 100 },
  { id: "deposit", title: "Deposit ETB 500 this week",           segment: "All players",    metric: "deposit", target: 500,  unit: "ETB",  points: 100 },
];

/** How many of the daily pool a player is shown at once. The card on My Casino
 *  is built around three tasks. */
export const DAILY_CHALLENGE_COUNT = 3;

/**
 * Pool the daily card draws from (resets 00:00 UTC). Same shape and the same
 * points-only reward as the weekly set — only the window differs, so both run
 * through the same route and the same claim ledger.
 *
 * Admin-editable: Rewards → Challenges. Bigger than what's shown in a day on
 * purpose, so the card is different tomorrow without anyone scheduling it.
 */
export const DAILY_CHALLENGES: Challenge[] = [
  { id: "d-wager-300",   title: "Wager ETB 300 today",        segment: "All players",    metric: "wager",   target: 300,  unit: "ETB",  points: 40 },
  { id: "d-bets-10",     title: "Play 10 casino rounds today", segment: "Casino players", metric: "bets",    target: 10,   unit: "bets", points: 30 },
  { id: "d-deposit-100", title: "Deposit ETB 100 today",       segment: "All players",    metric: "deposit", target: 100,  unit: "ETB",  points: 40 },
  { id: "d-wager-1000",  title: "Wager ETB 1,000 today",       segment: "High rollers",   metric: "wager",   target: 1000, unit: "ETB",  points: 90 },
  { id: "d-bets-25",     title: "Play 25 casino rounds today",  segment: "Active players", metric: "bets",    target: 25,   unit: "bets", points: 60 },
  { id: "d-wager-500",   title: "Wager ETB 500 today",          segment: "Casino players", metric: "wager",   target: 500,  unit: "ETB",  points: 50 },
  { id: "d-deposit-250", title: "Deposit ETB 250 today",        segment: "All players",    metric: "deposit", target: 250,  unit: "ETB",  points: 70 },
  { id: "d-bets-50",     title: "Play 50 casino rounds today",  segment: "High rollers",   metric: "bets",    target: 50,   unit: "bets", points: 120 },
];

/**
 * Today's slice of the daily pool.
 *
 * Deterministic from the day number, which is what makes this need no cron, no
 * stored "today's set" and no per-player state: every player sees the same
 * three, and they change on their own at 00:00 UTC. The window slides by
 * `count` each day, so a pool larger than `count` keeps cycling rather than
 * showing the same trio twice in a row.
 */
export function pickDailyChallenges(
  pool: Challenge[],
  dayIndex: number,
  count: number = DAILY_CHALLENGE_COUNT,
): Challenge[] {
  if (pool.length <= count) return pool;
  // Double modulo so a negative day index (a clock set before 1970) still lands
  // inside the pool rather than reading off the front of it.
  const start = (((dayIndex * count) % pool.length) + pool.length) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}

/** What an achievement measures — all metrics are lifetime / monotonic, so an
 *  achievement, once earned, can never be lost. */
export type AchievementMetric = "bets" | "wins" | "bigWin" | "wagered" | "deposits" | "points";

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  badge: string;
  metric: AchievementMetric;
  target: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-bet",     name: "First Spin",    desc: "Place your first casino bet",      badge: "/badges/football-fanatic.svg", metric: "bets",     target: 1 },
  { id: "first-win",     name: "First Win",     desc: "Win your first round",             badge: "/badges/first-win.svg",        metric: "wins",     target: 1 },
  { id: "funded-up",     name: "Funded Up",     desc: "Make your first deposit",          badge: "/badges/bronze.svg",           metric: "deposits", target: 1 },
  { id: "warming-up",    name: "Warming Up",    desc: "Play 10 casino rounds",            badge: "/badges/on-fire.svg",          metric: "bets",     target: 10 },
  { id: "century",       name: "Century",       desc: "Play 100 casino rounds",           badge: "/badges/night-owl.svg",        metric: "bets",     target: 100 },
  { id: "big-winner",    name: "Big Winner",    desc: "Land a single win of ETB 5,000+",  badge: "/badges/influencer.svg",       metric: "bigWin",   target: 5000 },
  { id: "high-roller",   name: "High Roller",   desc: "Wager ETB 100,000 in total",       badge: "/badges/high-roller.svg",      metric: "wagered",  target: 100000 },
  { id: "whale",         name: "Whale",         desc: "Wager ETB 500,000 in total",       badge: "/badges/diamond.svg",          metric: "wagered",  target: 500000 },
  { id: "silver-club",   name: "Silver Club",   desc: "Reach Silver tier",                badge: "/badges/silver.svg",           metric: "points",   target: 1000 },
  { id: "gold-club",     name: "Gold Club",     desc: "Reach Gold tier",                  badge: "/badges/gold.svg",             metric: "points",   target: 5000 },
  { id: "diamond-mind",  name: "Diamond Mind",  desc: "Reach Diamond tier",               badge: "/badges/diamond-mind.svg",     metric: "points",   target: 40000 },
  { id: "vip-elite",     name: "VIP Elite",     desc: "Reach VIP tier",                   badge: "/badges/vip.svg",              metric: "points",   target: 100000 },
];

// ── Leaderboards ───────────────────────────────────────────────────────────
// Real leaderboards are served by /api/user/leaderboards (ranked from live
// transactions + loyalty points). No seeded data.

// ── VIP & Whale Retention ──────────────────────────────────────────────────

export const VIP_CRITERIA: { label: string; value: string }[] = [
  { label: "Total wagered (lifetime)",   value: "ETB 1,000,000+" },
  { label: "Monthly wager (30 days)",    value: "ETB 200,000+" },
  { label: "Loyalty points",             value: "100,000+" },
  { label: "Account age",                value: "30+ days" },
  { label: "Account standing",           value: "No fraud / chargeback flags" },
];

export const VIP_STANDARD: string[] = [
  "Dedicated account manager — reply within 4 hours",
  "15% weekly cashback on losses (no cap)",
  "Priority withdrawals within 4 hours",
  "Higher bet limits — 2× standard maximum",
  "Monthly reload bonus, negotiated personally",
];

export const VIP_ELITE: string[] = [
  "Personal manager on WhatsApp / Telegram",
  "20% weekly cashback + ETB 5,000 birthday bonus",
  "Instant withdrawals — within 15 minutes",
  "Custom bet limits, case by case",
  "Invitations to real-world events & hospitality",
  "Early access to new features and games",
];

// ── Casino-specific retention ──────────────────────────────────────────────

export interface Tournament {
  id: string;
  name: string;
  format: string;
  prize: string;
  frequency: string;
  endsIn: string;
  vip?: boolean;
}

export const SLOT_TOURNAMENTS: Tournament[] = [
  { id: "spin-race",  name: "Spin Race",     format: "Most spins in 24 hours",   prize: "ETB 25,000",  frequency: "Daily",   endsIn: "07:42:11" },
  { id: "high-score", name: "High Score",    format: "Biggest single multiplier", prize: "ETB 50,000",  frequency: "Weekly",  endsIn: "3d 04h" },
  { id: "points-race",name: "Points Race",   format: "Most points from slots",    prize: "ETB 100,000 · top 10", frequency: "Weekly", endsIn: "3d 04h" },
  { id: "vip-exc",    name: "VIP Exclusive", format: "Invite-only · higher stakes", prize: "ETB 250,000", frequency: "Monthly", endsIn: "18d", vip: true },
];

export interface DropWinState {
  prizePool: string;
  eligibleGames: number;
  nextDropIn: string;
  recentWinners: { name: string; amount: string }[];
}

export const DROP_WIN: DropWinState = {
  prizePool: "ETB 480,000",
  eligibleGames: 24,
  nextDropIn: "00:14:23",
  recentWinners: [
    { name: "Yonas M.",  amount: "ETB 12,000" },
    { name: "Sara T.",   amount: "ETB 4,500" },
    { name: "Abebe W.",  amount: "ETB 8,200" },
  ],
};

/** Three scratch-card mini-tasks; completing all three pays out. */
export const CHALLENGE_CARD: { tasks: { label: string; done: boolean }[]; reward: string } = {
  tasks: [
    { label: "Win 3 spins in a row",      done: true  },
    { label: "Trigger a bonus feature",   done: true  },
    { label: "Wager ETB 1,000 on slots",  done: false },
  ],
  reward: "25 free spins",
};

/** Progressive jackpot seed + growth, used by the live nav meter. */
export const JACKPOT_SEED = 4_512_000; // ETB
export const JACKPOT_GROWTH_PER_SEC = 7.5; // ETB/sec, illustrative
