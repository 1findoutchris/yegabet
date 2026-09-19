import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentPosition } from "@/lib/agentLedger";

/*
 * Release accrued cash-rail commission into spendable float. Run on the 1st.
 *
 * Commission is booked as CASH_COMMISSION at the moment each deposit or payout
 * happens, so the amount owed is always derivable; this only converts it. That
 * split is what makes a missed or double run harmless — the accrual is the
 * source of truth, and this is a transfer between two views of it.
 *
 * Idempotent per (agent, month): the release row carries `refId` =
 * `commission-YYYY-MM`, checked under the same row lock that guards float, so a
 * scheduler firing twice pays once.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Label the payout with the month being closed, not the month it runs in —
  // a run on 1 September releases August's earnings.
  const now = new Date();
  const closing = new Date(now.getFullYear(), now.getMonth(), 0);
  const period = `${closing.getFullYear()}-${String(closing.getMonth() + 1).padStart(2, "0")}`;
  const refId = `commission-${period}`;

  const agents = await prisma.withdrawalAgent.findMany({
    where: { isCashAgent: true },
    select: { id: true },
  });

  const released: { agentId: string; amount: number }[] = [];
  let skipped = 0;

  for (const { id } of agents) {
    const paid = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM withdrawal_agents WHERE id = ${id} FOR UPDATE`;

      const already = await tx.withdrawalAgentTxn.findFirst({
        where: { agentId: id, type: "COMMISSION_PAYOUT", refId },
        select: { id: true },
      });
      if (already) return 0;

      const rows = await tx.withdrawalAgentTxn.groupBy({
        by: ["type"], where: { agentId: id }, _sum: { amount: true },
      });
      const owed = agentPosition(rows).pendingCommission;
      if (owed <= 0) return 0;

      await tx.withdrawalAgentTxn.create({
        data: { agentId: id, type: "COMMISSION_PAYOUT", amount: owed, refId,
          note: `Commission for ${period} released to float` },
      });
      return owed;
    });

    if (paid > 0) released.push({ agentId: id, amount: paid });
    else skipped++;
  }

  return NextResponse.json({ period, released, skipped });
}
