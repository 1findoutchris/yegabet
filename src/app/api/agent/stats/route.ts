import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { withdrawable } from "@/lib/wallet";

/**
 * GET — the agent's dashboard numbers: commission earned (COMMISSION txns),
 * ticket totals, and wallet position. "Owed" on the admin side is this same
 * commission sum plus whatever withdrawal requests are still pending.
 */
export async function GET() {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const [user, commission, tickets] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        balance: true, depositBalance: true, bonusBalance: true,
        commissionRate: true, username: true, name: true,
      },
    }),
    prisma.transaction.aggregate({
      where: { userId: auth.userId, type: "COMMISSION", status: "COMPLETED" },
      _sum: { amount: true }, _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { agentId: auth.userId },
      _count: { _all: true },
      _sum: { totalStake: true, totalWin: true },
    }),
  ]);

  const byStatus = Object.fromEntries(
    tickets.map((t) => [t.status, { count: t._count._all, stake: Number(t._sum.totalStake ?? 0), win: Number(t._sum.totalWin ?? 0) }])
  );

  return NextResponse.json({
    username: user?.username,
    name: user?.name,
    commissionRate: Number(user?.commissionRate ?? 0),
    balance: Number(user?.balance ?? 0),
    withdrawable: withdrawable({
      balance: Number(user?.balance ?? 0),
      depositBalance: Number(user?.depositBalance ?? 0),
      bonusBalance: Number(user?.bonusBalance ?? 0),
    }),
    commissionEarned: Number(commission._sum.amount ?? 0),
    commissionCount: commission._count._all,
    tickets: byStatus,
  });
}
