import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { getRewardConfig, setRewardConfig, REWARD_BLOCK_KEYS, type RewardBlockKey } from "@/lib/rewardConfig";
import { z } from "zod";

// Metric enums are wired in code (how each reward is credited), so the admin can
// only pick from existing values — a genuinely new metric still needs code.
const challengeMetric = z.enum(["wager", "bets", "deposit"]);
const achievementMetric = z.enum(["bets", "wins", "bigWin", "wagered", "deposits", "points"]);

const rate = z.number().min(0).max(1); // 0..1 fraction
const nonNegInt = z.number().int().min(0);
const nonNeg = z.number().min(0);

const pointsEconomy = z.object({
  pointsPerEtbWagered: nonNeg,
  winBonusPct: rate,
  dailyPlayPoints: nonNegInt,
  firstDepositOfWeekPoints: nonNegInt,
  minStreakBet: nonNeg,
  // Must be positive — the redeem route divides points by it.
  pointsPerEtb: z.number().positive(),
  minRedeemPoints: z.number().int().positive(),
});

const streakMilestones = z
  .array(
    z.object({
      day: z.number().int().positive(),
      points: nonNegInt,
      etb: nonNeg,
      reward: z.string().trim().min(1).max(120),
    })
  )
  .min(1);

// One shape for both windows — a daily challenge is a weekly one with a shorter
// clock, so validating them apart would only let the two drift.
const challengeList = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(40),
      title: z.string().trim().min(1).max(120),
      segment: z.string().trim().min(1).max(60),
      metric: challengeMetric,
      target: z.number().positive(),
      unit: z.string().trim().min(1).max(16),
      points: nonNegInt,
    })
  )
  .min(1);

const tiers = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(40),
      min: nonNegInt,
      max: z.number().int().positive().nullable(),
      cashback: z.string().trim().min(1).max(16), // display copy e.g. "6%"
      cashbackRate: rate,
      cashbackCap: nonNeg,
      color: z.string().trim().min(1).max(32),
      badge: z.string().trim().min(1).max(200),
    })
  )
  .min(1)
  // Tier logic (tierForPoints) assumes an ascending, non-overlapping ladder.
  .refine((ts) => ts.every((t, i) => i === 0 || t.min > ts[i - 1].min), {
    message: "Tiers must be sorted by ascending, non-equal min points",
  });

const achievements = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(60),
      desc: z.string().trim().min(1).max(160),
      badge: z.string().trim().min(1).max(200),
      metric: achievementMetric,
      target: z.number().positive(),
    })
  )
  .min(1);

// Shared "unique ids" guard for the CRUD list blocks.
function uniqueIds<T extends { id: string }>(rows: T[]): boolean {
  return new Set(rows.map((r) => r.id)).size === rows.length;
}

const spinWheel = z.object({
  enabled: z.boolean(),
  creditsPerReferral: z.number().int().min(0).max(100),
  // A ceiling on the ceiling: the weekly cap is the blast-radius limit on
  // referral farming, so it must not be settable to something absurd.
  maxCreditsPerWeek: z.number().int().min(0).max(1000),
  // Capped far lower than creditsPerReferral: this one multiplies against every
  // single registration, with no weekly ceiling to bound it.
  signupCredits: z.number().int().min(0).max(20),
});

// A blank date means "no bound"; anything else must be YYYY-MM-DD.
const isoDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Date must be YYYY-MM-DD");

const bonusRule = {
  enabled: z.boolean(),
  pct: rate, // 0..1
  // Caps the bonus itself, not the deposit. Zero disables the rule, so there is
  // no way to express "uncapped" — deliberate, on a percentage of free money.
  maxEtb: z.number().min(0).max(1_000_000),
  minDepositEtb: nonNeg,
};

const depositBonus = z.object({
  firstDeposit: z.object(bonusRule),
  reload: z.object({ ...bonusRule, startsAt: isoDay, endsAt: isoDay }),
});

const SCHEMAS: Record<RewardBlockKey, z.ZodTypeAny> = {
  pointsEconomy,
  spinWheel,
  depositBonus,
  streakMilestones,
  weeklyChallenges: challengeList.refine(uniqueIds, { message: "Duplicate challenge id" }),
  dailyChallenges: challengeList.refine(uniqueIds, { message: "Duplicate challenge id" }),
  tiers: tiers.refine(uniqueIds, { message: "Duplicate tier id" }),
  achievements: achievements.refine(uniqueIds, { message: "Duplicate achievement id" }),
};

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const config = await getRewardConfig();
  return NextResponse.json({ config });
}

const bodySchema = z.object({
  // Derived from REWARD_BLOCK_KEYS rather than re-listed, so a new block can't
  // be added to SCHEMAS and forgotten here.
  key: z.enum(REWARD_BLOCK_KEYS),
  value: z.unknown(),
});

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { key, value } = parsed.data;
  const valueParsed = SCHEMAS[key].safeParse(value);
  if (!valueParsed.success) {
    return NextResponse.json(
      { error: valueParsed.error.issues[0]?.message ?? "Invalid reward config" },
      { status: 400 }
    );
  }

  await setRewardConfig(key, valueParsed.data);

  await logAdminAction({
    action: "UPDATE_REWARD_CONFIG",
    targetId: key,
    targetType: "RewardConfig",
    ipAddress: getClientIp(req),
    metadata: { key },
  });

  return NextResponse.json({ success: true });
}
