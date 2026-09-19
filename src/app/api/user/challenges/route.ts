import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pickDailyChallenges, type Challenge, type ChallengeMetric } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import {
  isoWeekKey, isoWeekStart, utcDayKey, utcDayStart, dayIndexUtc, awardPoints,
} from "@/lib/loyalty";
import { Prisma } from "@prisma/client";
import { z } from "zod";

/*
 * Challenges for both windows. A daily challenge is a weekly one on a shorter
 * clock — same config shape, same progress metrics, same points-only reward —
 * so it runs through this route rather than a parallel copy of it.
 *
 * The window is the only real difference, and it decides three things at once:
 * which challenges are on offer, how far back progress is counted, and the key
 * that makes a claim idempotent.
 */

type Period = "daily" | "weekly";

interface Window {
  list: Challenge[];
  since: Date;
  /** Distinct by construction: "2026-W33" for a week, "2026-08-10" for a day,
   *  so a daily and a weekly claim can never share a reference. */
  key: string;
}

async function windowFor(period: Period): Promise<Window> {
  const config = await getRewardConfig();
  if (period === "weekly") {
    return { list: config.weeklyChallenges, since: isoWeekStart(), key: isoWeekKey() };
  }
  const now = new Date();
  return {
    // Today's slice, not the whole pool — claiming is checked against the same
    // list the player was shown, so a challenge that isn't on offer today can't
    // be claimed by calling the API directly.
    list: pickDailyChallenges(config.dailyChallenges, dayIndexUtc(now)),
    since: utcDayStart(now),
    key: utcDayKey(now),
  };
}

function periodFrom(value: string | null | undefined): Period {
  return value === "daily" ? "daily" : "weekly";
}

/** Activity for each challenge metric since `since`. */
async function progressSince(userId: string, since: Date): Promise<Record<ChallengeMetric, number>> {
  const [wagerAgg, betsCount, depositAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: "BET", createdAt: { gte: since } }, _sum: { amount: true },
    }),
    prisma.transaction.count({
      where: { userId, type: { in: ["BET", "WIN"] }, createdAt: { gte: since } },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: "DEPOSIT", createdAt: { gte: since } }, _sum: { amount: true },
    }),
  ]);
  return {
    wager: Number(wagerAgg._sum.amount ?? 0),
    bets: betsCount,
    deposit: Number(depositAgg._sum.amount ?? 0),
  };
}

function claimRef(userId: string, id: string, key: string): string {
  return `challenge-${userId}-${key}-${id}`;
}

// GET — each challenge on offer with live progress + claim state for the window.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const period = periodFrom(req.nextUrl.searchParams.get("period"));
  const { list, since, key } = await windowFor(period);
  const progress = await progressSince(userId, since);
  const refs = list.map((c) => claimRef(userId, c.id, key));
  const claimedRows = await prisma.transaction.findMany({
    where: { reference: { in: refs } }, select: { reference: true },
  });
  const claimedRefs = new Set(claimedRows.map((r) => r.reference));

  return NextResponse.json({
    period,
    challenges: list.map((c) => {
      const prog = progress[c.metric];
      const complete = prog >= c.target;
      const claimed = claimedRefs.has(claimRef(userId, c.id, key));
      return {
        id: c.id, title: c.title, segment: c.segment, unit: c.unit,
        target: c.target, progress: prog, points: c.points,
        complete, claimed, claimable: complete && !claimed,
      };
    }),
  });
}

const claimSchema = z.object({
  id: z.string().min(1),
  period: z.enum(["daily", "weekly"]).optional(),
});

// POST — claim a completed challenge's points (idempotent per window).
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

  const period = periodFrom(parsed.data.period);
  const { list, since, key } = await windowFor(period);
  const challenge = list.find((c) => c.id === parsed.data.id);
  if (!challenge) {
    return NextResponse.json({ error: "Unknown challenge" }, { status: 400 });
  }

  const progress = await progressSince(userId, since);
  if (progress[challenge.metric] < challenge.target) {
    return NextResponse.json({ error: "Challenge not complete yet" }, { status: 400 });
  }

  const reference = claimRef(userId, challenge.id, key);
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
      const before = Number(user?.balance ?? 0);

      // Points-only reward — balance unchanged; the record is for idempotency.
      await tx.transaction.create({
        data: {
          userId, type: "BONUS", status: "COMPLETED",
          amount: 0, balanceBefore: before, balanceAfter: before,
          reference,
          metadata: {
            kind: period === "daily" ? "daily_challenge" : "weekly_challenge",
            id: challenge.id,
            points: challenge.points,
          },
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: awardPoints(challenge.points),
      });
    });

    return NextResponse.json({ success: true, id: challenge.id, points: challenge.points });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Challenge already claimed" }, { status: 409 });
    }
    console.error("[user/challenges] claim failed", e);
    return NextResponse.json({ error: "Could not claim challenge" }, { status: 500 });
  }
}
