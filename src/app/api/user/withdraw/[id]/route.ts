import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundETB } from "@/lib/utils";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { withdrawable } from "@/lib/wallet";
import { closeWithdrawalTxn } from "@/lib/withdrawals";

// Player-initiated cancel of their own PENDING withdrawal. Refunds the reserved
// amount back to the wallet — the mirror of the admin "reject" path, but only
// available while the request is still pending (not yet approved/paid out).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  const result = await prisma.$transaction(async (tx) => {
    // Scope to this user so one player can't cancel another's request.
    const withdrawal = await tx.withdrawalRequest.findFirst({
      where: { id, userId },
      select: { id: true, amount: true, status: true, txnReference: true },
    });

    if (!withdrawal) return { error: "NOT_FOUND" as const };
    // Only PENDING can be pulled back. Once an agent hits Process the money may
    // already be in flight, so the player must not be able to cancel it.
    if (withdrawal.status !== "PENDING") return { error: "NOT_PENDING" as const };

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true, depositBalance: true, bonusBalance: true },
    });
    const amount = Number(withdrawal.amount);
    // The reserved funds came out of the withdrawable pot, so returning them to
    // `balance` alone puts them back exactly where they were.
    const refunded = roundETB(Number(user?.balance ?? 0) + amount);

    await tx.withdrawalRequest.update({
      where: { id },
      data: { status: "CANCELLED", adminNote: "Cancelled by user" },
    });
    await tx.user.update({
      where: { id: userId },
      data: { balance: refunded },
    });
    await closeWithdrawalTxn(tx, { userId, amount: withdrawal.amount, txnReference: withdrawal.txnReference }, "CANCELLED");

    return {
      refunded,
      withdrawable: withdrawable({
        balance: refunded,
        depositBalance: Number(user?.depositBalance ?? 0),
        bonusBalance: Number(user?.bonusBalance ?? 0),
      }),
      amount,
    };
  });

  if ("error" in result) {
    if (result.error === "NOT_FOUND") {
      return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "This request is already being paid out and can no longer be cancelled" },
      { status: 409 }
    );
  }

  // Update any open tabs' wallet immediately.
  await publishBalanceEvent(userId, {
    balance: result.refunded,
    withdrawable: result.withdrawable,
    reason: "adjust",
    amount: result.amount,
  });

  return NextResponse.json({ success: true, newBalance: result.refunded.toFixed(2) });
}
