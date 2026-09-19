import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const [
    pendingDeposits,
    pendingWithdrawals,
    totalUsers,
    activeToday,
    depositStatsToday,
    depositStatsWeek,
    withdrawalStatsWeek,
    recentDeposits,
    recentWithdrawals,
  ] = await Promise.all([
    prisma.depositRequest.count({ where: { status: "PENDING" } }),
    prisma.withdrawalRequest.count({ where: { status: "PENDING" } }),
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gte: todayStart } } }),

    prisma.transaction.aggregate({
      where: { type: "DEPOSIT", status: "COMPLETED", createdAt: { gte: todayStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { type: "DEPOSIT", status: "COMPLETED", createdAt: { gte: weekStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { type: "WITHDRAWAL", status: "COMPLETED", createdAt: { gte: weekStart } },
      _sum: { amount: true },
      _count: true,
    }),

    prisma.depositRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { username: true, name: true } } },
    }),
    prisma.withdrawalRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { user: { select: { username: true, name: true } } },
    }),
  ]);

  return NextResponse.json({
    pendingDeposits,
    pendingWithdrawals,
    totalUsers,
    activeToday,
    depositToday: { amount: Number(depositStatsToday._sum.amount ?? 0), count: depositStatsToday._count },
    depositWeek: { amount: Number(depositStatsWeek._sum.amount ?? 0), count: depositStatsWeek._count },
    withdrawalWeek: { amount: Number(withdrawalStatsWeek._sum.amount ?? 0), count: withdrawalStatsWeek._count },
    recentDeposits: recentDeposits.map((d) => ({
      id: d.id, username: d.user.username, name: d.user.name, amount: Number(d.amount),
      method: d.method, createdAt: d.createdAt,
    })),
    recentWithdrawals: recentWithdrawals.map((w) => ({
      id: w.id, username: w.user.username, name: w.user.name, amount: Number(w.amount),
      method: w.method, account: w.account, createdAt: w.createdAt,
    })),
  });
}
