import {
  STREAK_MILESTONES,
  WEEKLY_CHALLENGES,
  DAILY_CHALLENGES,
  TIERS,
  ACHIEVEMENTS,
  POINTS_PER_ETB_WAGERED,
  WIN_BONUS_PCT,
  DAILY_PLAY_POINTS,
  FIRST_DEPOSIT_OF_WEEK_POINTS,
  MIN_STREAK_BET,
  POINTS_PER_ETB,
  MIN_REDEEM_POINTS,
  type StreakMilestone,
  type Challenge,
  type Tier,
  type Achievement,
} from "./retention";
import type { DepositBonusConfig } from "./depositBonusCore";

export type { DepositBonusConfig };

/*
 * Pure reward-config shape + defaults + merge. No `server-only`, no prisma, so
 * it's safe to import anywhere and testable standalone (rewardConfig.check.ts).
 * The DB-backed getRewardConfig/setRewardConfig live in rewardConfig.ts.
 */

export interface PointsEconomy {
  pointsPerEtbWagered: number;
  winBonusPct: number;
  dailyPlayPoints: number;
  firstDepositOfWeekPoints: number;
  minStreakBet: number;
  pointsPerEtb: number;     // points that buy ETB 1 of locked bonus
  minRedeemPoints: number;  // floor per redemption (and the redemption step)
}

export interface SpinWheelConfig {
  // Defaults false: getRewardConfig swallows DB errors into these defaults, so
  // a config outage must close the wheel, not open an untuned one.
  enabled: boolean;
  creditsPerReferral: number;
  maxCreditsPerWeek: number; // rolling 7 days, per referrer
  // Coupons handed to every OTP-verified new signup. Unlike the referral grant
  // this has no weekly cap, so it multiplies against every registration —
  // keep it small and watch the expected-cost readout in the admin panel.
  signupCredits: number;
}

export interface RewardConfig {
  pointsEconomy: PointsEconomy;
  spinWheel: SpinWheelConfig;
  depositBonus: DepositBonusConfig;
  streakMilestones: StreakMilestone[];
  weeklyChallenges: Challenge[];
  /** Pool the daily card rotates through; see pickDailyChallenges. */
  dailyChallenges: Challenge[];
  tiers: Tier[];
  achievements: Achievement[];
}

export const REWARD_BLOCK_KEYS = [
  "pointsEconomy",
  "spinWheel",
  "depositBonus",
  "streakMilestones",
  "weeklyChallenges",
  "dailyChallenges",
  "tiers",
  "achievements",
] as const;

export type RewardBlockKey = (typeof REWARD_BLOCK_KEYS)[number];

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  pointsEconomy: {
    pointsPerEtbWagered: POINTS_PER_ETB_WAGERED,
    winBonusPct: WIN_BONUS_PCT,
    dailyPlayPoints: DAILY_PLAY_POINTS,
    firstDepositOfWeekPoints: FIRST_DEPOSIT_OF_WEEK_POINTS,
    minStreakBet: MIN_STREAK_BET,
    pointsPerEtb: POINTS_PER_ETB,
    minRedeemPoints: MIN_REDEEM_POINTS,
  },
  spinWheel: {
    enabled: false,
    creditsPerReferral: 1,
    maxCreditsPerWeek: 5,
    signupCredits: 3,
  },
  // Both ship OFF: this is free money on every deposit, so it must be switched
  // on deliberately. getRewardConfig also falls back to these defaults on a DB
  // error, and an outage must not start paying bonuses.
  depositBonus: {
    firstDeposit: { enabled: false, pct: 1, maxEtb: 1000, minDepositEtb: 50 },
    reload: { enabled: false, pct: 0.2, maxEtb: 500, minDepositEtb: 50, startsAt: "", endsAt: "" },
  },
  streakMilestones: STREAK_MILESTONES,
  weeklyChallenges: WEEKLY_CHALLENGES,
  dailyChallenges: DAILY_CHALLENGES,
  tiers: TIERS,
  achievements: ACHIEVEMENTS,
};

/** Pure merge of stored blocks over the defaults (DB-free, so it's testable). */
export function mergeRewardConfig(stored: Map<string, unknown>): RewardConfig {
  const d = DEFAULT_REWARD_CONFIG;
  return {
    // pointsEconomy field-merges so a partial stored object keeps defaults
    // for any key added to the economy later.
    pointsEconomy: { ...d.pointsEconomy, ...((stored.get("pointsEconomy") as Partial<PointsEconomy>) ?? {}) },
    // Same field-merge reasoning: a knob added to the wheel later keeps its
    // default for anyone who saved the block before it existed.
    spinWheel: { ...d.spinWheel, ...((stored.get("spinWheel") as Partial<SpinWheelConfig>) ?? {}) },
    // Merged one level deeper than the others: a top-level spread would let a
    // stored `firstDeposit` replace the whole rule object, so a field added to
    // a rule later would come back undefined for anyone who already saved.
    depositBonus: (() => {
      const s = (stored.get("depositBonus") as Partial<DepositBonusConfig>) ?? {};
      return {
        firstDeposit: { ...d.depositBonus.firstDeposit, ...(s.firstDeposit ?? {}) },
        reload: { ...d.depositBonus.reload, ...(s.reload ?? {}) },
      };
    })(),
    // list blocks are full CRUD → whole-block replace.
    streakMilestones: (stored.get("streakMilestones") as StreakMilestone[]) ?? d.streakMilestones,
    weeklyChallenges: (stored.get("weeklyChallenges") as Challenge[]) ?? d.weeklyChallenges,
    dailyChallenges: (stored.get("dailyChallenges") as Challenge[]) ?? d.dailyChallenges,
    tiers: (stored.get("tiers") as Tier[]) ?? d.tiers,
    achievements: (stored.get("achievements") as Achievement[]) ?? d.achievements,
  };
}
