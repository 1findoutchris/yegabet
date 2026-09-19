import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { roundETB } from "@/lib/utils";
import { recordPayout } from "@/lib/payoutAgents";
import { closeWithdrawalTxn, OPEN_WITHDRAWAL_STATUSES } from "@/lib/withdrawals";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { withdrawable } from "@/lib/wallet";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["process", "paid", "reject"]),
  note: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, note } = parsed.data;

  const w = await prisma.withdrawalRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, balance: true, depositBalance: true, bonusBalance: true } } },
  });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // An agent may only ever touch what was routed to them.
  if (w.withdrawalAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
  }
  if (!OPEN_WITHDRAWAL_STATUSES.includes(w.status as "PENDING" | "PROCESSING")) {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }

  const amountETB = Number(w.amount);
  const settleTarget = { userId: w.userId, amount: w.amount, txnReference: w.txnReference };

  // Lock it before sending money: the player can no longer cancel underneath.
  if (action === "process") {
    if (w.status === "PROCESSING") {
      return NextResponse.json({ error: "Already locked" }, { status: 409 });
    }
    await prisma.withdrawalRequest.update({
      where: { id },
      data: { status: "PROCESSING", processingAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  if (action === "paid") {
    // Requiring the lock first means money is never marked sent from a state
    // where the player could still have pulled the request out from under it.
    if (w.status !== "PROCESSING") {
      return NextResponse.json(
        { error: "Press Process first — that locks the player's funds before you send the money" },
        { status: 409 },
      );
    }

    const { commission } = await prisma.$transaction(async (tx) => {
      await tx.withdrawalRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          paidAt: new Date(),
          adminNote: note ?? "Paid out by agent",
        },
      });
      await closeWithdrawalTxn(tx, settleTarget, "COMPLETED");
      // Agent holds no float — this records what the platform now owes them.
      return recordPayout(tx, auth.agentId, amountETB, auth.commissionRate, id);
    });

    return NextResponse.json({ success: true, commission });
  }

  // reject — hand the money back to the player.
  const refunded = roundETB(Number(w.user.balance) + amountETB);
  await prisma.$transaction(async (tx) => {
    await tx.withdrawalRequest.update({
      where: { id },
      data: { status: "REJECTED", adminNote: note ?? "Rejected by payout agent" },
    });
    // The reserved funds came out of the withdrawable pot, so returning them to
    // `balance` alone puts them back exactly where they were.
    await tx.user.update({ where: { id: w.userId }, data: { balance: refunded } });
    await closeWithdrawalTxn(tx, settleTarget, "CANCELLED");
  });

  await publishBalanceEvent(w.userId, {
    balance: refunded,
    withdrawable: withdrawable({
      balance: refunded,
      depositBalance: Number(w.user.depositBalance),
      bonusBalance: Number(w.user.bonusBalance),
    }),
    reason: "adjust",
    amount: amountETB,
  });

  return NextResponse.json({ success: true });
}
