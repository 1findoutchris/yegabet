import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { effectiveStreak } from "@/lib/loyalty";
import { withdrawable } from "@/lib/wallet";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      balance: true, depositBalance: true, bonusBalance: true,
      loyaltyPoints: true, pointsBalance: true,
      streakDays: true, lastSeenAt: true, spinCredits: true,
    },
  });

  const wallet = {
    balance: Number(user?.balance ?? 0),
    depositBalance: Number(user?.depositBalance ?? 0),
    bonusBalance: Number(user?.bonusBalance ?? 0),
  };

  return NextResponse.json({
    // Total playable funds, and the three pots it splits into.
    balance: wallet.balance.toFixed(2),
    depositBalance: wallet.depositBalance.toFixed(2),
    bonusBalance: wallet.bonusBalance.toFixed(2),
    withdrawable: withdrawable(wallet).toFixed(2),
    // `points` is lifetime XP (drives the tier chip); `pointsBalance` is the
    // spendable wallet a redemption debits.
    points: user?.loyaltyPoints ?? 0,
    pointsBalance: user?.pointsBalance ?? 0,
    streakDays: effectiveStreak(user?.streakDays ?? 0, user?.lastSeenAt ?? null),
    // Unspent prize-wheel coupons — drives the "go spin" prompt.
    spinCredits: user?.spinCredits ?? 0,
  });
}
