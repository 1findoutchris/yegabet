import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundETB } from "@/lib/utils";
import { withdrawable } from "@/lib/wallet";
import { assignPayoutAgent, generatePublicId } from "@/lib/payoutAgents";
import { notifyNewWithdrawal } from "@/lib/telegram";
import { checkPaymentAmount } from "@/lib/paymentConfig";
import { CASH_MIN, CASH_MAX } from "@/lib/cashAgent";
import { randomUUID } from "crypto";
import { z } from "zod";

const schema = z.object({
  method: z.enum(["telebirr", "cbebirr", "ebirr", "cash"]),
  amount: z.number().positive(),
  // Bank/wallet rails need a destination account; cash needs an agent to
  // collect from, and the "account" is the counter itself.
  account: z.string().min(6).optional(),
  accountName: z.string().min(2).optional(),
  agentId: z.string().min(1).optional(),
}).refine(
  (d) => d.method === "cash" ? !!d.agentId : (!!d.account && !!d.accountName),
  "Missing destination",
);

// List the player's own withdrawal requests (newest first) so they can track
// status and cancel anything still pending.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await prisma.withdrawalRequest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, publicId: true, amount: true, method: true, account: true,
      status: true, adminNote: true, createdAt: true,
      proofKey: true, proofExpiresAt: true,
    },
  });

  const now = new Date();
  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      // Short code the player can quote to support.
      publicId: r.publicId,
      amount: Number(r.amount),
      method: r.method,
      account: r.account,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
      // Payment proof, hidden once expired (2 days).
      proofUrl: r.proofKey && r.proofExpiresAt && r.proofExpiresAt > now
        ? `/api/withdrawals/${r.id}/proof?v=${r.proofExpiresAt.getTime()}` : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { method, amount, agentId } = parsed.data;
  const userId = session.user.id;

  let account = parsed.data.account ?? "";
  let accountName = parsed.data.accountName ?? "";
  let cashAgentId: string | null = null;

  if (method === "cash") {
    // Cash has no PaymentAgent row — limits come from the cash-rail constants
    // rather than the per-method admin config.
    if (amount < CASH_MIN || amount > CASH_MAX) {
      return NextResponse.json(
        { error: `Cash withdrawals must be between ${CASH_MIN} and ${CASH_MAX.toLocaleString()} ETB` },
        { status: 400 },
      );
    }

    const [agent, user] = await Promise.all([
      prisma.withdrawalAgent.findUnique({
        where: { id: agentId! },
        select: { id: true, name: true, username: true, isCashAgent: true, isActive: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { cashAgentId: true } }),
    ]);
    if (!agent?.isCashAgent || !agent.isActive) {
      return NextResponse.json({ error: "That agent is not available" }, { status: 400 });
    }

    // Locked to whoever took their deposit — but only while that agent is still
    // active, so nobody's balance is trapped behind an agent who has left.
    if (user?.cashAgentId && user.cashAgentId !== agent.id) {
      const bound = await prisma.withdrawalAgent.findUnique({
        where: { id: user.cashAgentId },
        select: { name: true, username: true, isActive: true, isCashAgent: true },
      });
      if (bound?.isActive && bound.isCashAgent) {
        return NextResponse.json(
          { error: `You deposited with ${bound.name || bound.username}, so cash withdrawals go back through them.` },
          { status: 400 },
        );
      }
    }

    cashAgentId = agent.id;
    account = agent.username;
    accountName = agent.name || agent.username;
  } else {
    // Same gate as the deposit route — the UI hiding a method or capping the
    // input is presentation, this is what stops a stale tab reserving funds
    // against a dead rail or outside the admin's limits.
    const rejection = await checkPaymentAmount(method, "withdraw", amount);
    if (rejection) {
      return NextResponse.json({ error: rejection }, { status: 400 });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true, depositBalance: true, bonusBalance: true },
    });

    const cashBalance = Number(user?.balance ?? 0);
    // Only winnings can leave — deposit and bonus funds are playable but not
    // withdrawable until they've been staked and won back.
    const cashable = withdrawable({
      balance: cashBalance,
      depositBalance: Number(user?.depositBalance ?? 0),
      bonusBalance: Number(user?.bonusBalance ?? 0),
    });

    if (amount > cashBalance) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    if (amount > cashable) {
      throw new Error("NOT_WITHDRAWABLE");
    }

    const newBalance = roundETB(cashBalance - amount);

    // Deduct from balance immediately — funds are reserved while pending review
    await tx.user.update({
      where: { id: userId },
      data: { balance: newBalance },
    });

    // Record as a PENDING WITHDRAWAL transaction. The reference is generated
    // up front and stored on the request, so settling later targets exactly
    // this row even if the player has another request of the same amount.
    const txnReference = `wd-${randomUUID()}`;
    await tx.transaction.create({
      data: {
        userId,
        type: "WITHDRAWAL",
        status: "PENDING",
        amount,
        balanceBefore: cashBalance,
        balanceAfter: newBalance,
        reference: txnReference,
        metadata: { method, account, accountName },
      },
    });

    // Cash goes to the agent the player picked. Every other rail is routed to
    // whoever covers that method with the least open work, skipping any whose
    // per-withdrawal ceiling this amount clears. No eligible agent just leaves
    // it unassigned in the admin queue.
    const assignedId = cashAgentId ?? (await assignPayoutAgent(tx, method, amount));
    const publicId = await generatePublicId(tx);

    const request = await tx.withdrawalRequest.create({
      data: {
        userId, amount, method, account, accountName,
        publicId, txnReference,
        withdrawalAgentId: assignedId,
        assignedAt: assignedId ? new Date() : null,
      },
      select: { id: true, publicId: true },
    });

    return { withdrawalId: request.id, publicId: request.publicId, newBalance };
  }).catch((e: Error) => {
    if (e.message === "INSUFFICIENT_BALANCE") return { blocked: "INSUFFICIENT_BALANCE" as const };
    if (e.message === "NOT_WITHDRAWABLE") return { blocked: "NOT_WITHDRAWABLE" as const };
    throw e;
  });

  if (!result) throw new Error("Unexpected null result");

  if ("blocked" in result) {
    if (result.blocked === "NOT_WITHDRAWABLE") {
      return NextResponse.json(
        { error: "Only your winnings can be withdrawn. Deposit and bonus funds become withdrawable once you play with them." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Amount exceeds your available balance" },
      { status: 400 }
    );
  }

  // After the commit, never inside it: a slow Telegram call would hold the
  // lock on the player's balance row. Failures are swallowed by notify itself.
  await notifyNewWithdrawal(prisma, result.withdrawalId);

  return NextResponse.json({
    success: true,
    withdrawalId: result.withdrawalId,
    // Short quotable code the player can reference in support chats.
    publicId: result.publicId,
    newBalance: result.newBalance.toFixed(2),
  });
}
