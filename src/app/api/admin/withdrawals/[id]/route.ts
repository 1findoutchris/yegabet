import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { roundETB } from "@/lib/utils";
import { closeWithdrawalTxn, OPEN_WITHDRAWAL_STATUSES } from "@/lib/withdrawals";
import { notifyNewWithdrawal } from "@/lib/telegram";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["approve", "reject", "process", "reassign"]),
  note: z.string().optional(),
  /** reassign only — target payout agent, or null to unassign. */
  agentId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { action, note, agentId } = parsed.data;

  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, balance: true } } },
  });

  if (!withdrawal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!OPEN_WITHDRAWAL_STATUSES.includes(withdrawal.status as "PENDING" | "PROCESSING")) {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }

  const ip = getClientIp(req);
  const amount = Number(withdrawal.amount);
  const settleTarget = {
    userId: withdrawal.userId,
    amount: withdrawal.amount,
    txnReference: withdrawal.txnReference,
  };

  // Lock the funds: the player can no longer cancel while money is in flight.
  if (action === "process") {
    if (withdrawal.status === "PROCESSING") {
      return NextResponse.json({ error: "Already being processed" }, { status: 409 });
    }
    await prisma.withdrawalRequest.update({
      where: { id },
      data: { status: "PROCESSING", processingAt: new Date(), adminNote: note ?? "Locked by admin" },
    });
    await logAdminAction({
      action: "PROCESS_WITHDRAWAL", targetId: id, targetType: "WithdrawalRequest",
      note: note ?? undefined, ipAddress: ip, metadata: { userId: withdrawal.userId, amount },
    });
    return NextResponse.json({ success: true });
  }

  // Escape hatch for a request routed to an agent who never actioned it.
  // Round-robin assigns automatically, so without this a stuck request has no
  // way forward.
  if (action === "reassign") {
    if (withdrawal.status === "PROCESSING") {
      return NextResponse.json(
        { error: "Already being paid out — reject it first if the agent didn't send the money" },
        { status: 409 },
      );
    }
    await prisma.withdrawalRequest.update({
      where: { id },
      data: {
        withdrawalAgentId: agentId ?? null,
        // Restart the SLA clock so the new agent isn't judged on someone
        // else's delay.
        assignedAt: agentId ? new Date() : null,
        adminNote: note ?? "Reassigned by admin",
      },
    });
    await logAdminAction({
      action: "REASSIGN_WITHDRAWAL", targetId: id, targetType: "WithdrawalRequest",
      note: note ?? undefined, ipAddress: ip,
      metadata: { from: withdrawal.withdrawalAgentId, to: agentId ?? null },
    });
    // The new agent gets the same Telegram ping a freshly created request does,
    // otherwise a reassignment is invisible to everyone but the portal.
    if (agentId) await notifyNewWithdrawal(prisma, id);
    return NextResponse.json({ success: true });
  }

  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      await tx.withdrawalRequest.update({
        where: { id },
        data: { status: "APPROVED", adminNote: note ?? "Approved by admin", paidAt: new Date() },
      });
      await closeWithdrawalTxn(tx, settleTarget, "COMPLETED");
    });
    await logAdminAction({
      action: "APPROVE_WITHDRAWAL",
      targetId: id,
      targetType: "WithdrawalRequest",
      note: note ?? undefined,
      ipAddress: ip,
      metadata: { userId: withdrawal.userId, amount },
    });
    return NextResponse.json({ success: true });
  }

  // reject — refund balance back to user
  const currentBalance = Number(withdrawal.user.balance);
  const refunded = roundETB(currentBalance + amount);

  await prisma.$transaction(async (tx) => {
    await tx.withdrawalRequest.update({
      where: { id },
      data: { status: "REJECTED", adminNote: note ?? "Rejected by admin" },
    });
    // The reserved funds came out of the withdrawable pot, so returning them to
    // `balance` alone puts them back where they were.
    await tx.user.update({ where: { id: withdrawal.userId }, data: { balance: refunded } });
    await closeWithdrawalTxn(tx, settleTarget, "CANCELLED");
  });

  await logAdminAction({
    action: "REJECT_WITHDRAWAL",
    targetId: id,
    targetType: "WithdrawalRequest",
    note: note ?? undefined,
    ipAddress: ip,
    metadata: { userId: withdrawal.userId, amount, refunded },
  });
  return NextResponse.json({ success: true });
}
