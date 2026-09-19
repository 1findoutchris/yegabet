import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRewardConfig } from "@/lib/rewardConfig";
import { reloadWindowOpen } from "@/lib/depositBonusCore";

/* What deposit bonus this player would earn right now, so the deposit page can
   advertise it. Read-only — approveDeposit re-quotes server-side at credit
   time, so a stale or tampered response here can't pay anyone anything. */
export async function GET() {
  const session = await auth();
  const { depositBonus } = await getRewardConfig();

  // Logged out: show the welcome offer, since that's what they'd get.
  let isFirstDeposit = true;
  if (session?.user?.id) {
    const priorDeposits = await prisma.transaction.count({
      where: { userId: session.user.id, type: "DEPOSIT", status: "COMPLETED" },
    });
    isFirstDeposit = priorDeposits === 0;
  }

  const first = depositBonus.firstDeposit;
  const reload = depositBonus.reload;

  const offers: { rule: string; pct: number; maxEtb: number; minDepositEtb: number }[] = [];
  if (isFirstDeposit && first.enabled && first.pct > 0 && first.maxEtb > 0) {
    offers.push({ rule: "firstDeposit", pct: first.pct, maxEtb: first.maxEtb, minDepositEtb: first.minDepositEtb });
  }
  if (reloadWindowOpen(reload, new Date()) && reload.pct > 0 && reload.maxEtb > 0) {
    offers.push({ rule: "reload", pct: reload.pct, maxEtb: reload.maxEtb, minDepositEtb: reload.minDepositEtb });
  }

  // Only the better one can ever pay, so only the better one is advertised.
  const best = offers.sort((a, b) => b.maxEtb * b.pct - a.maxEtb * a.pct)[0] ?? null;

  return NextResponse.json({ offer: best });
}
