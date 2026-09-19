/*
 * Self-check for the reward-config merge logic.
 * Run: `npx tsx src/lib/rewardConfig.check.ts`
 */
import assert from "node:assert";
import { mergeRewardConfig, DEFAULT_REWARD_CONFIG } from "./rewardConfigCore";

// No stored rows → exactly the defaults.
assert.deepStrictEqual(mergeRewardConfig(new Map()), DEFAULT_REWARD_CONFIG);

// Partial pointsEconomy override → that field changes, siblings keep defaults.
const merged = mergeRewardConfig(
  new Map<string, unknown>([["pointsEconomy", { firstDepositOfWeekPoints: 999 }]])
);
assert.strictEqual(merged.pointsEconomy.firstDepositOfWeekPoints, 999);
assert.strictEqual(
  merged.pointsEconomy.dailyPlayPoints,
  DEFAULT_REWARD_CONFIG.pointsEconomy.dailyPlayPoints
);

// List block → whole-block replace (full CRUD).
const one = [{ day: 5, points: 5, etb: 5, reward: "x" }];
const m2 = mergeRewardConfig(new Map<string, unknown>([["streakMilestones", one]]));
assert.deepStrictEqual(m2.streakMilestones, one);

console.log("rewardConfig self-check passed");
