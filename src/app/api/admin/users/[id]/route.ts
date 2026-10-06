import { NextRequest, NextResponse } from "next/server";
import { TELEGRAM_CLEARED } from "@/lib/tgLink";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { tierForPoints } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import { roundETB } from "@/lib/utils";
import { withdrawable } from "@/lib/wallet";
import { applyAdjustment, BUCKETS, type Bucket } from "@/lib/adminAdjust";
import { z } from "zod";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;

  const [user, txns, deposits, withdrawals, depositTotal, withdrawalTotal] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true, accountNo: true, username: true, name: true, phone: true, email: true,
        balance: true, depositBalance: true, bonusBalance: true,
        loyaltyPoints: true, loyaltyTier: true, isActive: true, isVerified: true,
        role: true, referralCode: true, createdAt: true, lastSeenAt: true,
        streakDays: true, spinCredits: true,
        telegramUserId: true, telegramUsername: true, telegramLinkedAt: true,
        _count: { select: { bets: true, depositRequests: true, withdrawalRequests: true } },
      },
    }),
    prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, status: true, amount: true, balanceBefore: true, balanceAfter: true, reference: true, createdAt: true, metadata: true },
    }),
    // The request tables, not the ledger: PENDING and REJECTED attempts never
    // get a Transaction row, so they are invisible in `txns` above — and those
    // are exactly the ones an admin is looking for when a player complains.
    prisma.depositRequest.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, amount: true, method: true, status: true, smsRef: true, receiptText: true, adminNote: true, createdAt: true, updatedAt: true },
    }),
    prisma.withdrawalRequest.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, publicId: true, amount: true, method: true, account: true, accountName: true, status: true, adminNote: true, createdAt: true, updatedAt: true, paidAt: true, proofKey: true, proofExpiresAt: true },
    }),
    // Lifetime money in and out, over every request rather than the 20 above.
    // APPROVED only — a rejected or still-pending request never moved any cash,
    // and counting it would overstate what this player is actually up or down.
    prisma.depositRequest.aggregate({
      where: { userId: id, status: "APPROVED" },
      _sum: { amount: true },
    }),
    prisma.withdrawalRequest.aggregate({
      where: { userId: id, status: "APPROVED" },
      _sum: { amount: true },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { tiers } = await getRewardConfig();

  return NextResponse.json({
    ...user,
    balance: Number(user.balance),
    depositBalance: Number(user.depositBalance),
    bonusBalance: Number(user.bonusBalance),
    withdrawable: withdrawable({
      balance: Number(user.balance),
      depositBalance: Number(user.depositBalance),
      bonusBalance: Number(user.bonusBalance),
    }),
    loyaltyTier: tierForPoints(user.loyaltyPoints, tiers).id.toUpperCase(),
    totalDeposited: Number(depositTotal._sum.amount ?? 0),
    totalWithdrawn: Number(withdrawalTotal._sum.amount ?? 0),
    transactions: txns.map((t) => ({
      ...t,
      amount: Number(t.amount),
      balanceBefore: Number(t.balanceBefore),
      balanceAfter: Number(t.balanceAfter),
    })),
    deposits: deposits.map((d) => ({ ...d, amount: Number(d.amount) })),
    // proofKey is the bucket path — it never goes to the browser. The client
    // only needs to know whether there is a live proof worth fetching, which is
    // the same freshness test the withdrawals list uses.
    withdrawals: withdrawals.map(({ proofKey, proofExpiresAt, ...w }) => ({
      ...w,
      amount: Number(w.amount),
      hasProof: !!proofKey && !!proofExpiresAt && proofExpiresAt > new Date(),
    })),
  });
}

const adjustSchema = z.object({
  action: z.enum(["adjust", "ban", "unban", "unlock-funds", "grant-spins", "clear-cash-agent", "unlink-telegram"]),
  amount: z.number().optional(),
  // Omitted → "withdrawable", which is exactly the behaviour this route had
  // before buckets existed, so older callers are unaffected.
  bucket: z.enum(BUCKETS).optional(),
  note: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { action, amount, note } = parsed.data;
  const bucket: Bucket = parsed.data.bucket ?? "withdrawable";
  const ip = getClientIp(req);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, balance: true, isActive: true,
      depositBalance: true, bonusBalance: true, spinCredits: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wallet = {
    balance: Number(user.balance),
    depositBalance: Number(user.depositBalance),
    bonusBalance: Number(user.bonusBalance),
  };

  if (action === "adjust") {
    if (amount === undefined) return NextResponse.json({ error: "amount required" }, { status: 400 });

    const result = applyAdjustment(wallet, bucket, amount);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const { before, after, update } = result;

    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: update }),
      prisma.transaction.create({
        data: {
          userId: id,
          // Deliberately not DEPOSIT even for the deposit bucket: DEPOSIT rows
          // feed the weekly deposit challenge and the first-deposit-of-week
          // bonus, and an admin adjustment must not earn the player either.
          type: amount >= 0 ? "BONUS" : "WITHDRAWAL",
          status: "COMPLETED",
          amount: Math.abs(amount),
          balanceBefore: before,
          balanceAfter: after,
          reference: `admin-adj-${Date.now()}`,
          metadata: { kind: "admin_adjust", bucket, reason: note ?? "Admin adjustment" },
        },
      }),
    ]);
    await logAdminAction({
      action: "ADJUST_BALANCE", targetId: id, targetType: "User", note, ipAddress: ip,
      metadata: { amount, bucket, before, after },
    });
  }

  // Frees a player bound to a cash agent to withdraw through any of them. The
  // binding already lapses when the agent is deactivated; this covers the case
  // where the agent is still working but the player needs to move.
  if (action === "clear-cash-agent") {
    await prisma.user.update({ where: { id }, data: { cashAgentId: null } });
    await logAdminAction({ action: "CLEAR_CASH_AGENT", targetId: id, targetType: "User", note, ipAddress: ip });
    return NextResponse.json({ success: true });
  }

  // Releases the Telegram link so the player can link a different Telegram
  // account (the bot never moves a link on its own — see tgLinkCore). Touches
  // only the telegram* columns.
  if (action === "unlink-telegram") {
    await prisma.user.update({ where: { id }, data: TELEGRAM_CLEARED });
    await logAdminAction({ action: "UNLINK_TELEGRAM", targetId: id, targetType: "User", note, ipAddress: ip });
    return NextResponse.json({ success: true });
  }

  if (action === "ban" || action === "unban") {
    const isActive = action === "unban";
    await prisma.user.update({ where: { id }, data: { isActive } });
    await logAdminAction({ action: action.toUpperCase(), targetId: id, targetType: "User", note, ipAddress: ip });
  }

  // Hand out (or claw back) prize-wheel coupons. Not money, so no ledger row —
  // AdminLog is the audit trail, and every spin they're used on is recorded in
  // SpinResult anyway.
  if (action === "grant-spins") {
    if (amount === undefined || !Number.isInteger(amount) || amount === 0) {
      return NextResponse.json({ error: "Whole, non-zero number of spins required" }, { status: 400 });
    }
    if (Math.abs(amount) > 100) {
      return NextResponse.json({ error: "At most 100 spins at a time" }, { status: 400 });
    }

    const before = user.spinCredits;
    // Clamp a deduction to what they hold, so credits can't go negative — the
    // same rule applyAdjustment enforces for wallet pots.
    if (amount < 0 && before + amount < 0) {
      return NextResponse.json(
        { error: `Player only has ${before} ${before === 1 ? "spin" : "spins"}` },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: { spinCredits: { increment: amount } },
    });
    await logAdminAction({
      action: "GRANT_SPINS", targetId: id, targetType: "User", note, ipAddress: ip,
      metadata: { amount, before, after: before + amount },
    });
  }

  // Make every pot withdrawable in one go: empty the deposit and bonus pots
  // without changing the total, which turns the whole balance into winnings.
  if (action === "unlock-funds") {
    const freed = roundETB(wallet.depositBalance + wallet.bonusBalance);
    await prisma.user.update({
      where: { id },
      data: { depositBalance: 0, bonusBalance: 0 },
    });
    await logAdminAction({
      action: "UNLOCK_FUNDS", targetId: id, targetType: "User", note, ipAddress: ip,
      metadata: { freed, balance: wallet.balance },
    });
  }

  return NextResponse.json({ success: true });
}

/**
 * Erase a player and everything hanging off them. Irreversible — a ban
 * (POST action:"ban") is the reversible option and stays the right tool for
 * anything you might want back.
 *
 * The refusals below are deliberate: an account holding money, with a payout in
 * flight, or wired to an agent/affiliate portal cannot be deleted without
 * losing something that has to reconcile. Settle it first, then delete.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, username: true, phone: true, role: true,
      balance: true, depositBalance: true, bonusBalance: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const held = roundETB(
    Number(user.balance) + Number(user.depositBalance) + Number(user.bonusBalance)
  );
  if (held !== 0) {
    return NextResponse.json(
      { error: `Account still holds ETB ${held.toFixed(2)}. Zero the balance first, or ban instead.` },
      { status: 400 }
    );
  }

  // AGENT/AFFILIATE users own a portal row keyed by userId with no foreign key
  // to enforce it, so deleting them would leave a portal pointing at nobody.
  if (user.role !== "USER") {
    return NextResponse.json(
      { error: `${user.role} accounts can't be deleted here — ban the account instead.` },
      { status: 400 }
    );
  }

  const pending = await prisma.withdrawalRequest.count({
    where: { userId: id, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (pending > 0) {
    return NextResponse.json(
      { error: "Settle or reject the open withdrawal request first." },
      { status: 400 }
    );
  }

  // Every child row, oldest FK last. push_subscriptions already cascade;
  // spin_results and spin_credit_grants carry no foreign key, so they'd be
  // silently orphaned rather than blocking — cleared here for the same reason.
  await prisma.$transaction([
    prisma.user.updateMany({ where: { referredById: id }, data: { referredById: null } }),
    prisma.transaction.deleteMany({ where: { userId: id } }),
    prisma.bet.deleteMany({ where: { userId: id } }),
    prisma.userBonus.deleteMany({ where: { userId: id } }),
    prisma.withdrawalRequest.deleteMany({ where: { userId: id } }),
    prisma.depositRequest.deleteMany({ where: { userId: id } }),
    prisma.recentGame.deleteMany({ where: { userId: id } }),
    prisma.favoriteGame.deleteMany({ where: { userId: id } }),
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.spinResult.deleteMany({ where: { userId: id } }),
    prisma.spinCreditGrant.deleteMany({
      where: { OR: [{ referrerId: id }, { refereeId: id }] },
    }),
    prisma.user.delete({ where: { id } }),
  ]);

  // The row is gone, so the log line is the only record it ever existed.
  await logAdminAction({
    action: "DELETE_USER",
    targetId: id,
    targetType: "User",
    note: `@${user.username} · ${user.phone}`,
    ipAddress: getClientIp(req),
    metadata: { username: user.username, phone: user.phone },
  });

  return NextResponse.json({ success: true });
}
