import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { agentPosition } from "@/lib/agentLedger";

/** The signed-in payout agent, plus what the platform currently owes them. */
export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [agent, ledger] = await Promise.all([
    prisma.withdrawalAgent.findUnique({
      where: { id: auth.agentId },
      select: { username: true, name: true, methods: true, commissionRate: true, slaMinutes: true, isCashAgent: true },
    }),
    // No running balance column — both positions are sums of the ledger.
    prisma.withdrawalAgentTxn.groupBy({
      by: ["type"],
      where: { agentId: auth.agentId },
      _sum: { amount: true },
    }),
  ]);

  const pos = agentPosition(ledger);

  return NextResponse.json({
    username: agent?.username,
    name: agent?.name,
    methods: agent?.methods ?? [],
    commissionRate: Number(agent?.commissionRate ?? 0),
    slaMinutes: agent?.slaMinutes ?? 30,
    isCashAgent: agent?.isCashAgent ?? false,
    paidOut: pos.paidOut,
    commission: pos.commission,
    settled: pos.settled,
    outstanding: pos.outstanding,
    float: pos.float,
    pendingCommission: pos.pendingCommission,
  });
}
