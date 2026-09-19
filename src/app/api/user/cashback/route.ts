import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundETB } from "@/lib/utils";
import { tierForPoints } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import { isoWeekKey } from "@/lib/loyalty";
import { grantBonus } from "@/lib/bonus";
import { Prisma } from "@prisma/client";

const WINDOW_DAYS = 7;

// Compute the player's claimable weekly cashback from real activity:
// (trailing-7-day net loss) × (tier cashback rate), claimable once per ISO week.
async function computeCashback(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { loyaltyPoints: true },
  });
  const { tiers } = await getRewardConfig();
  const tier = tierForPoints(user?.loyaltyPoints ?? 0, tiers);

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [betAgg, winAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: "BET", createdAt: { gte: since } }, _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: "WIN", createdAt: { gte: since } }, _sum: { amount: true },
    }),
  ]);

  const wagered = Number(betAgg._sum.amount ?? 0);
  const won = Number(winAgg._sum.amount ?? 0);
  const netLoss = Math.max(0, roundETB(wagered - won));
  // Rate × net loss, capped at the tier's weekly ceiling.
  const claimable = roundETB(Math.min(netLoss * tier.cashbackRate, tier.cashbackCap));

  const reference = `cashback-${userId}-${isoWeekKey()}`;
  const already = await prisma.transaction.findUnique({ where: { reference } });

  return {
    tierName: tier.name,
    ratePct: tier.cashback,
    rate: tier.cashbackRate,
    cap: tier.cashbackCap,
    netLoss,
    claimable,
    claimedThisWeek: !!already,
    reference,
  };
}

// GET — preview this week's claimable cashback.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const c = await computeCashback(session.user.id);
  return NextResponse.json({
    tierName: c.tierName, ratePct: c.ratePct, cap: c.cap, netLoss: c.netLoss,
    claimable: c.claimable, claimedThisWeek: c.claimedThisWeek,
  });
}

// POST — claim this week's cashback into the balance (idempotent per ISO week).
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const c = await computeCashback(userId);

  if (c.claimedThisWeek) {
    return NextResponse.json({ error: "Cashback already claimed this week" }, { status: 409 });
  }
  if (c.claimable <= 0) {
    return NextResponse.json({ error: "No cashback to claim yet" }, { status: 400 });
  }

  try {
    // Cashback lands in the bonus pot: playable at once, withdrawable only once
    // it's been staked and won back. Unique reference = one claim per ISO week.
    await prisma.$transaction((tx) =>
      grantBonus(tx, {
        userId,
        amount: c.claimable,
        reference: c.reference,
        kind: "weekly_cashback",
        metadata: { netLoss: c.netLoss, rate: c.rate },
      }),
    );

    return NextResponse.json({ success: true, claimed: c.claimable, bonus: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Cashback already claimed this week" }, { status: 409 });
    }
    console.error("[user/cashback] claim failed", e);
    return NextResponse.json({ error: "Could not claim cashback" }, { status: 500 });
  }
}
