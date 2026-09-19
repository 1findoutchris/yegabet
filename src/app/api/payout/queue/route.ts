import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { slaState } from "@/lib/payoutRouting";
import { OPEN_WITHDRAWAL_STATUSES } from "@/lib/withdrawals";

/**
 * The agent's work queue, plus recent history.
 *
 * Requests are routed to one agent automatically, so an agent only ever sees
 * their own — never another agent's queue.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const done = req.nextUrl.searchParams.get("view") === "history";

  const rows = await prisma.withdrawalRequest.findMany({
    where: {
      withdrawalAgentId: auth.agentId,
      status: done
        ? { in: ["APPROVED", "REJECTED", "CANCELLED"] }
        : { in: [...OPEN_WITHDRAWAL_STATUSES] },
    },
    orderBy: done ? { updatedAt: "desc" } : { assignedAt: "asc" },
    take: done ? 50 : 100,
    select: {
      id: true, publicId: true, amount: true, method: true,
      account: true, accountName: true, status: true,
      assignedAt: true, processingAt: true, paidAt: true,
      adminNote: true, createdAt: true, updatedAt: true,
      proofKey: true, proofExpiresAt: true,
      user: { select: { accountNo: true, username: true, phone: true } },
    },
  });

  const now = new Date();
  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      publicId: r.publicId,
      amount: Number(r.amount),
      method: r.method,
      account: r.account,
      accountName: r.accountName,
      status: r.status,
      accountNo: r.user.accountNo,
      username: r.user.username,
      phone: r.user.phone,
      adminNote: r.adminNote,
      // Whether a payment proof is currently attached and still visible to
      // the player — the agent needs to know if they already sent one.
      hasProof: !!r.proofKey && !!r.proofExpiresAt && r.proofExpiresAt > now,
      createdAt: r.createdAt,
      processingAt: r.processingAt,
      paidAt: r.paidAt,
      // Clock stops at payout, so a request paid on time never drifts into
      // breach just because it's being viewed later.
      sla: slaState(r.assignedAt, r.paidAt, auth.slaMinutes, now),
    })),
    slaMinutes: auth.slaMinutes,
  });
}
