import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type AchievementMetric } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import { effectiveStreak } from "@/lib/loyalty";

// GET — which achievements the player has earned (from lifetime activity) plus
// the current streak, so the engagement watcher can detect new unlocks/streaks.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [betCount, winCount, winMax, betSum, depCount, user] = await Promise.all([
    prisma.transaction.count({ where: { userId, type: { in: ["BET", "WIN"] } } }),
    prisma.transaction.count({ where: { userId, type: "WIN" } }),
    prisma.transaction.aggregate({ where: { userId, type: "WIN" }, _max: { amount: true } }),
    prisma.transaction.aggregate({ where: { userId, type: "BET" }, _sum: { amount: true } }),
    prisma.transaction.count({ where: { userId, type: "DEPOSIT" } }),
    prisma.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true, streakDays: true, lastSeenAt: true } }),
  ]);

  const stats: Record<AchievementMetric, number> = {
    bets: betCount,
    wins: winCount,
    bigWin: Number(winMax._max.amount ?? 0),
    wagered: Number(betSum._sum.amount ?? 0),
    deposits: depCount,
    points: user?.loyaltyPoints ?? 0,
  };

  const { achievements } = await getRewardConfig();
  const earned = achievements.filter((a) => stats[a.metric] >= a.target).map((a) => a.id);

  return NextResponse.json({
    earned,
    streakDays: effectiveStreak(user?.streakDays ?? 0, user?.lastSeenAt ?? null),
  });
}
