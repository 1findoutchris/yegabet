import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { REVERSAL_WINDOW_MS } from "@/lib/cashAgent";

/** This agent's recent counter deposits, flagged with whether each can still
 *  be cancelled. The API re-checks the window on the way in — this only decides
 *  whether a button is drawn. */
export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rows = await prisma.withdrawalAgentTxn.findMany({
    where: { agentId: auth.agentId, type: "CASH_DEPOSIT" },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { amount: true, refId: true, createdAt: true },
  });

  const ids = rows.map((r) => r.refId).filter((x): x is string => !!x);
  const deposits = await prisma.depositRequest.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, user: { select: { name: true, username: true, accountNo: true } } },
  });
  const byId = new Map(deposits.map((d) => [d.id, d]));

  const now = Date.now();
  return NextResponse.json({
    windowMs: REVERSAL_WINDOW_MS,
    deposits: rows.flatMap((r) => {
      const d = r.refId ? byId.get(r.refId) : undefined;
      if (!d) return [];
      return [{
        id: d.id,
        amount: Number(r.amount),
        name: d.user.name || d.user.username,
        accountNo: d.user.accountNo,
        createdAt: r.createdAt,
        status: d.status,
        reversible:
          d.status === "APPROVED" &&
          now - r.createdAt.getTime() <= REVERSAL_WINDOW_MS,
      }];
    }),
  });
}
