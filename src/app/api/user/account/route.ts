import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tierForPoints } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import { withdrawable } from "@/lib/wallet";

function computeReferralCode(id: string): string {
  let h = 5381;
  for (const c of id) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const [user, txns, pendingDeposits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountNo: true,
        username: true, name: true, phone: true, email: true,
        balance: true, depositBalance: true, bonusBalance: true,
        loyaltyPoints: true, pointsBalance: true, referralCode: true,
        isVerified: true, createdAt: true,
      },
    }),
    prisma.transaction.findMany({
      // Admin balance adjustments are excluded. A deduction is written as a
      // WITHDRAWAL row (see admin/users/[id] "adjust"), so without this the
      // player sees a withdrawal they never requested. Admin credits are
      // already invisible here — they land as BONUS, which this list omits —
      // so hiding deductions makes the two directions consistent.
      //
      // Matched on the reference prefix, not metadata.kind: `reference` is
      // non-null, so `not startsWith` is null-safe. The equivalent JSON filter
      // (NOT metadata.path(["kind"]).equals) matches nothing at all, because
      // rows whose metadata has no `kind` key compare as NULL and get dropped
      // along with the adjustments.
      where: {
        userId,
        type: { in: ["DEPOSIT", "WITHDRAWAL"] },
        reference: { not: { startsWith: "admin-adj-" } },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, type: true, status: true, amount: true, createdAt: true, metadata: true },
    }),
    // Pending deposit requests have no transaction yet (one is created only on
    // approval), so surface them separately so the player sees them queued.
    prisma.depositRequest.findMany({
      where: { userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, amount: true, method: true, createdAt: true },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Lazy backfill: users who registered before the referral feature was added
  // won't have a stored code. Compute and persist it now so their link works.
  let code = user.referralCode;
  if (!code) {
    code = computeReferralCode(userId);
    prisma.user.update({ where: { id: userId }, data: { referralCode: code } }).catch(() => {});
  }

  const { tiers } = await getRewardConfig();

  return NextResponse.json({
    username: user.username,
    name: user.name,
    phone: user.phone,
    email: user.email,
    balance: Number(user.balance),
    depositBalance: Number(user.depositBalance),
    bonusBalance: Number(user.bonusBalance),
    withdrawable: withdrawable({
      balance: Number(user.balance),
      depositBalance: Number(user.depositBalance),
      bonusBalance: Number(user.bonusBalance),
    }),
    // Tier is derived from lifetime points (single source of truth).
    loyaltyTier: tierForPoints(user.loyaltyPoints, tiers).id.toUpperCase(),
    loyaltyPoints: user.loyaltyPoints,
    pointsBalance: user.pointsBalance,
    referralCode: code,
    accountNo: user.accountNo,
    isVerified: user.isVerified,
    memberSince: user.createdAt,
    transactions: txns.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      amount: Number(t.amount),
      createdAt: t.createdAt,
      method: (t.metadata as { method?: string } | null)?.method ?? null,
    })),
    pendingDeposits: pendingDeposits.map((d) => ({
      id: d.id,
      amount: Number(d.amount),
      method: d.method,
      createdAt: d.createdAt,
    })),
  });
}
