import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRewardConfig } from "@/lib/rewardConfig";
import { quoteRedemption, maxRedeemablePoints } from "@/lib/retention";
import { grantBonus } from "@/lib/bonus";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { withdrawable } from "@/lib/wallet";
import { z } from "zod";

/* Spend loyalty points on locked bonus credit.
 *
 * Only `pointsBalance` is debited — `loyaltyPoints` is lifetime XP and stays
 * put, so redeeming can never demote a player out of a tier or revoke a badge
 * they already earned. See awardPoints() in src/lib/loyalty.ts. */

class InsufficientPointsError extends Error {}

async function loadState(userId: string) {
  const [user, { pointsEconomy }] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } }),
    getRewardConfig(),
  ]);
  const pointsBalance = user?.pointsBalance ?? 0;
  const { pointsPerEtb, minRedeemPoints } = pointsEconomy;

  return {
    pointsBalance,
    pointsPerEtb,
    minRedeemPoints,
    maxPoints: maxRedeemablePoints(pointsBalance, pointsPerEtb, minRedeemPoints),
  };
}

// GET — what the player can redeem right now, and at what rate.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const s = await loadState(session.user.id);
  return NextResponse.json({
    ...s,
    maxEtb: s.maxPoints / s.pointsPerEtb,
  });
}

const bodySchema = z.object({ points: z.number().int().positive() });

// POST — spend points for locked bonus credit.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { pointsBalance, pointsPerEtb, minRedeemPoints } = await loadState(userId);
  const priced = quoteRedemption(parsed.data.points, pointsBalance, pointsPerEtb, minRedeemPoints);
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 400 });
  }
  const { points, etb } = priced.quote;

  // ponytail: no idempotency key. The compare-and-set below makes overspend
  // impossible, so a double-tap is just two valid redemptions, not a loss —
  // the client disables the button while the request is in flight. Add a
  // caller-supplied key only if support tickets say otherwise.
  const reference = `redeem-${userId}-${randomUUID()}`;

  try {
    await prisma.$transaction(async (tx) => {
      // Atomic compare-and-set: this compiles to
      //   UPDATE users SET "pointsBalance" = "pointsBalance" - $1
      //   WHERE id = $2 AND "pointsBalance" >= $1
      // so two concurrent redeems can never both succeed on the same points.
      // A plain read-then-write here would be a double-spend.
      const spent = await tx.user.updateMany({
        where: { id: userId, pointsBalance: { gte: points } },
        data: { pointsBalance: { decrement: points } },
      });
      if (spent.count === 0) throw new InsufficientPointsError();

      return grantBonus(tx, {
        userId,
        amount: etb,
        reference,
        kind: "points_redemption",
        metadata: { pointsSpent: points, pointsPerEtb },
      });
    });

    // The grant raised `balance` into the non-withdrawable bonus pot and spent
    // points — nudge any other open tab to re-read the snapshot.
    const fresh = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true, depositBalance: true, bonusBalance: true },
    });
    if (fresh) {
      await publishBalanceEvent(userId, {
        balance: Number(fresh.balance),
        withdrawable: withdrawable({
          balance: Number(fresh.balance),
          depositBalance: Number(fresh.depositBalance),
          bonusBalance: Number(fresh.bonusBalance),
        }),
        reason: "bonus",
      });
    }

    return NextResponse.json({
      success: true,
      pointsSpent: points,
      etb,
      pointsBalance: pointsBalance - points,
    });
  } catch (e) {
    if (e instanceof InsufficientPointsError) {
      return NextResponse.json({ error: "Not enough points" }, { status: 400 });
    }
    console.error("[user/points/redeem] redemption failed", e);
    return NextResponse.json({ error: "Could not redeem points" }, { status: 500 });
  }
}
