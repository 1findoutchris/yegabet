import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundETB } from "@/lib/utils";
import { getRewardConfig } from "@/lib/rewardConfig";
import { effectiveStreak, dayIndexUtc, awardPoints } from "@/lib/loyalty";
import { grantBonus } from "@/lib/bonus";
import { Prisma } from "@prisma/client";
import { z } from "zod";

// The day the current streak started — used to scope claims to one streak cycle
// (resetting the streak yields a new cycle, so milestones become claimable again).
function cycleStart(streakDays: number, lastSeenAt: Date | null): number | null {
  if (!lastSeenAt || streakDays <= 0) return null;
  return dayIndexUtc(lastSeenAt) - (streakDays - 1);
}

function claimRef(userId: string, cycle: number, day: number): string {
  return `streak-${userId}-${cycle}-d${day}`;
}

async function loadState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { streakDays: true, lastSeenAt: true },
  });
  const { streakMilestones } = await getRewardConfig();
  const streak = effectiveStreak(user?.streakDays ?? 0, user?.lastSeenAt ?? null);
  const cycle = cycleStart(user?.streakDays ?? 0, user?.lastSeenAt ?? null);

  // Which milestone refs in this cycle have already been claimed?
  let claimedDays = new Set<number>();
  if (cycle !== null) {
    const refs = streakMilestones.map((m) => claimRef(userId, cycle, m.day));
    const rows = await prisma.transaction.findMany({
      where: { reference: { in: refs } },
      select: { reference: true },
    });
    const claimedRefs = new Set(rows.map((r) => r.reference));
    claimedDays = new Set(
      streakMilestones.filter((m) => claimedRefs.has(claimRef(userId, cycle, m.day))).map((m) => m.day)
    );
  }

  return { streak, cycle, claimedDays, streakMilestones };
}

// GET — streak counter + per-cycle milestone claim state.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { streak, claimedDays, streakMilestones } = await loadState(session.user.id);

  return NextResponse.json({
    streakDays: streak,
    milestones: streakMilestones.map((m) => {
      const reached = streak >= m.day;
      const claimed = claimedDays.has(m.day);
      return {
        day: m.day, reward: m.reward, points: m.points, etb: m.etb,
        reached, claimed, claimable: reached && !claimed,
      };
    }),
  });
}

const claimSchema = z.object({ day: z.number().int().positive() });

// POST — claim a reached milestone (idempotent per streak cycle).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { streakMilestones, pointsEconomy } = await getRewardConfig();
  const milestone = streakMilestones.find((m) => m.day === parsed.data.day);
  if (!milestone) {
    return NextResponse.json({ error: "Unknown milestone" }, { status: 400 });
  }

  const { streak, cycle } = await loadState(userId);
  if (cycle === null || streak < milestone.day) {
    return NextResponse.json({ error: "Milestone not reached yet" }, { status: 400 });
  }

  const reference = claimRef(userId, cycle, milestone.day);

  try {
    await prisma.$transaction(async (tx) => {
      // ETB lands in the bonus pot: playable at once, withdrawable only once
      // staked and won back. The unique reference enforces one claim per
      // milestone per streak cycle (race-safe).
      await grantBonus(tx, {
        userId,
        amount: milestone.etb,
        reference,
        kind: "streak_milestone",
        metadata: { day: milestone.day, points: milestone.points },
      });

      if (milestone.points > 0) {
        await tx.user.update({
          where: { id: userId },
          data: awardPoints(milestone.points),
        });
      }
    });

    return NextResponse.json({
      success: true, day: milestone.day,
      points: milestone.points, etb: milestone.etb,
      bonus: milestone.etb > 0,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Milestone already claimed" }, { status: 409 });
    }
    console.error("[user/streak] claim failed", e);
    return NextResponse.json({ error: "Could not claim milestone" }, { status: 500 });
  }
}
