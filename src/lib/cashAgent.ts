import "server-only";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { approveDeposit } from "./deposits";
import { agentPosition } from "./agentLedger";
import { closeWithdrawalTxn } from "./withdrawals";
import { roundETB } from "./utils";

/*
 * The cash rail — an agent taking notes over a counter and crediting a player.
 *
 * The player side deliberately goes through approveDeposit rather than touching
 * balances here, so a cash deposit earns the same deposit bonus, the same
 * first-deposit-of-week points, and — the part that matters — the same
 * `depositBalance` increment. Without that increment the money would be
 * immediately withdrawable, and cash-in/cash-out with no wager in between is a
 * laundering rail, not a deposit.
 */

/** Amount bounds for a single counter deposit, in ETB. */
export const CASH_MIN = 10;
export const CASH_MAX = 100_000;

/**
 * How long an agent may cancel their own deposit.
 *
 * Short on purpose. This is a fix for "typed 5000 instead of 500" while the
 * customer is still at the counter — not a tool for undoing a deposit after
 * they have walked away, which would let an agent keep the cash and the credit.
 * Anything older is an admin's call.
 */
export const REVERSAL_WINDOW_MS = 10 * 60 * 1000;

export type CashDepositError =
  | "NOT_CASH_AGENT"
  | "INSUFFICIENT_FLOAT"
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "CODE_NOT_FOUND"
  | "CODE_ALREADY_USED"
  | "WRONG_AGENT"
  | "DEPOSIT_NOT_FOUND"
  | "WINDOW_EXPIRED"
  | "ALREADY_REVERSED"
  | "FUNDS_SPENT";

export class CashError extends Error {
  constructor(public code: CashDepositError, public detail?: string) {
    super(code);
  }
}

/** Commission the agent earns on a cash transaction, at their configured rate.
 *  Accrues as CASH_COMMISSION — spendable only after the monthly release. */
export function commissionOn(amount: number, rate: number): number {
  return roundETB((amount * rate) / 100);
}

/**
 * Read an agent's float inside a transaction, holding a row lock on the agent
 * for the rest of it.
 *
 * ponytail: per-agent row lock rather than a balance column with a conditional
 * update. One agent's counter is inherently serial — a human takes one customer
 * at a time — so the lock is uncontended in practice, and it keeps float
 * derivable from the ledger instead of being a number that can drift from the
 * rows meant to explain it. Move to a stored balance only if an agent ever
 * needs concurrent tills.
 */
export async function lockFloat(
  tx: Prisma.TransactionClient,
  agentId: string,
): Promise<number> {
  await tx.$queryRaw`SELECT id FROM withdrawal_agents WHERE id = ${agentId} FOR UPDATE`;
  const rows = await tx.withdrawalAgentTxn.groupBy({
    by: ["type"],
    where: { agentId },
    _sum: { amount: true },
  });
  return agentPosition(rows).float;
}

/**
 * Credit `amount` to the player holding `accountNo`, paid for out of the
 * agent's float. Returns the new float and the player's name.
 *
 * The float debit runs inside approveDeposit's own transaction via its `inTx`
 * hook, so the agent is charged if and only if the player is credited.
 */
export async function cashDeposit(
  agentId: string,
  accountNo: number,
  amount: number,
): Promise<{ float: number; name: string; depositId: string }> {
  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id: agentId },
    select: { id: true, isCashAgent: true, isActive: true, commissionRate: true },
  });
  if (!agent?.isCashAgent || !agent.isActive) throw new CashError("NOT_CASH_AGENT");

  const user = await prisma.user.findUnique({
    where: { accountNo },
    select: { id: true, name: true, username: true, isActive: true },
  });
  if (!user) throw new CashError("USER_NOT_FOUND");
  if (!user.isActive) throw new CashError("USER_INACTIVE");

  // Unique per attempt: a rejected attempt burns a reference nobody reuses, and
  // a retry gets a fresh one rather than colliding with the failed try.
  const ref = `cash-${randomUUID()}`;

  const deposit = await prisma.depositRequest.create({
    data: {
      userId: user.id,
      amount,
      method: "cash",
      receiptText: `Cash received over the counter by agent ${agentId}.`,
      smsRef: ref,
      status: "PENDING",
    },
    select: { id: true },
  });

  let floatAfter = 0;

  const credited = await approveDeposit(deposit.id, user.id, amount, ref, async (tx) => {
    const before = await lockFloat(tx, agentId);
    if (before < amount) {
      throw new CashError("INSUFFICIENT_FLOAT", `float is ${before.toFixed(2)}`);
    }
    await tx.withdrawalAgentTxn.create({
      data: {
        agentId,
        type: "CASH_DEPOSIT",
        amount,
        refId: deposit.id,
        note: `Counter deposit to account ${accountNo}`,
      },
    });

    const earned = commissionOn(amount, Number(agent.commissionRate));
    if (earned > 0) {
      await tx.withdrawalAgentTxn.create({
        data: { agentId, type: "CASH_COMMISSION", amount: earned, refId: deposit.id,
          note: `${Number(agent.commissionRate)}% of ${amount} deposited` },
      });
    }

    // Bind the player to this agent for cash withdrawals. Written here rather
    // than after the fact so a crash can't leave money moved but the binding
    // missing — the whole point is that cash out follows cash in.
    await tx.user.update({ where: { id: user.id }, data: { cashAgentId: agentId } });

    floatAfter = roundETB(before - amount);
  }).catch(async (e) => {
    // The request never became a deposit — mark it so it doesn't sit in the
    // admin's PENDING queue looking like a player waiting on approval.
    await prisma.depositRequest.update({
      where: { id: deposit.id },
      data: { status: "REJECTED", adminNote: e instanceof CashError ? e.code : "Cash deposit failed" },
    }).catch(() => {});
    throw e;
  });

  // approveDeposit returns false only when the reference was already used, and
  // this one is freshly minted — so this is unreachable rather than a real
  // branch. Surfaced rather than ignored so a broken assumption is loud.
  if (!credited) throw new Error("Cash deposit reference collided");

  return { float: floatAfter, name: user.name || user.username, depositId: deposit.id };
}

/**
 * Cancel a counter deposit the agent just made, putting the money back.
 *
 * Only possible while the credit is demonstrably untouched. A bet drains
 * deposit → bonus → withdrawable (see wallet.ts), so `depositBalance` falling
 * below the amount is proof the player has played with it — no per-deposit
 * tracking needed, and no way to claw back money that has already been staked
 * or won on.
 */
export async function reverseCashDeposit(
  agentId: string,
  depositId: string,
  now: Date = new Date(),
): Promise<{ float: number; amount: number; name: string }> {
  const deposit = await prisma.depositRequest.findUnique({
    where: { id: depositId },
    select: {
      id: true, userId: true, amount: true, method: true, status: true, createdAt: true,
      user: { select: { name: true, username: true } },
    },
  });
  if (!deposit || deposit.method !== "cash" || deposit.status !== "APPROVED") {
    throw new CashError("DEPOSIT_NOT_FOUND");
  }

  // The ledger row is what ties this deposit to this agent — the DepositRequest
  // itself doesn't carry an agent id.
  const booked = await prisma.withdrawalAgentTxn.findFirst({
    where: { agentId, type: "CASH_DEPOSIT", refId: depositId },
    select: { id: true },
  });
  if (!booked) throw new CashError("DEPOSIT_NOT_FOUND");

  if (now.getTime() - deposit.createdAt.getTime() > REVERSAL_WINDOW_MS) {
    throw new CashError("WINDOW_EXPIRED");
  }

  const amount = Number(deposit.amount);

  return prisma.$transaction(async (tx) => {
    const before = await lockFloat(tx, agentId);

    // Consume the deposit row conditionally, so two taps can't reverse twice.
    const { count } = await tx.depositRequest.updateMany({
      where: { id: depositId, status: "APPROVED" },
      data: { status: "REVERSED", adminNote: `Cancelled by agent within ${REVERSAL_WINDOW_MS / 60000} minutes` },
    });
    if (count === 0) throw new CashError("ALREADY_REVERSED");

    const user = await tx.user.findUniqueOrThrow({
      where: { id: deposit.userId },
      select: { balance: true, depositBalance: true },
    });
    const balance = Number(user.balance);
    const locked = Number(user.depositBalance);

    // Untouched means the whole amount is still sitting in the deposit pot.
    if (locked < amount || balance < amount) throw new CashError("FUNDS_SPENT");

    await tx.user.update({
      where: { id: deposit.userId },
      data: {
        balance: roundETB(balance - amount),
        depositBalance: roundETB(locked - amount),
      },
    });

    // The credit's ledger row is reversed rather than deleted — the player's
    // statement should show both, not a gap.
    await tx.transaction.create({
      data: {
        userId: deposit.userId,
        type: "WITHDRAWAL",
        status: "COMPLETED",
        amount,
        balanceBefore: balance,
        balanceAfter: roundETB(balance - amount),
        reference: `cash-rev-${depositId}`,
        metadata: { kind: "cash_deposit_reversal", depositRequestId: depositId, agentId },
      },
    });

    await tx.withdrawalAgentTxn.create({
      data: { agentId, type: "CASH_REVERSAL", amount, refId: depositId,
        note: "Counter deposit cancelled" },
    });

    // Give back the commission that deposit earned, if any.
    const earned = await tx.withdrawalAgentTxn.findFirst({
      where: { agentId, type: "CASH_COMMISSION", refId: depositId },
      select: { amount: true },
    });
    if (earned) {
      await tx.withdrawalAgentTxn.create({
        data: { agentId, type: "CASH_COMMISSION_REVERSAL", amount: earned.amount, refId: depositId,
          note: "Commission on a cancelled deposit" },
      });
    }

    return {
      float: roundETB(before + amount),
      amount,
      name: deposit.user.name || deposit.user.username,
    };
  }, { timeout: 20_000 });
}

/**
 * Look a withdrawal code up for the agent about to pay it, without consuming it.
 *
 * Scoped to the agent it was issued to: a code is quotable out loud, so any
 * agent could otherwise try codes until one landed and claim someone else's
 * payout against their own float.
 */
export async function lookupCode(agentId: string, code: string) {
  const req = await prisma.withdrawalRequest.findUnique({
    where: { publicId: code.trim().toUpperCase() },
    select: {
      id: true, publicId: true, amount: true, status: true, method: true,
      withdrawalAgentId: true,
      user: { select: { name: true, username: true, accountNo: true } },
    },
  });
  if (!req || req.method !== "cash") throw new CashError("CODE_NOT_FOUND");
  if (req.withdrawalAgentId !== agentId) throw new CashError("WRONG_AGENT");
  if (req.status !== "PENDING") throw new CashError("CODE_ALREADY_USED", req.status);

  return {
    id: req.id,
    code: req.publicId,
    amount: Number(req.amount),
    name: req.user.name || req.user.username,
    accountNo: req.user.accountNo,
  };
}

/**
 * Pay a withdrawal code out in cash: the agent hands over notes and takes the
 * player's reserved balance in return, so their float goes up by the amount.
 *
 * The consume is a conditional update rather than read-then-write — that single
 * `updateMany` is what makes a code one-use, even if two devices submit it at
 * the same instant.
 */
export async function redeemCode(
  agentId: string,
  code: string,
): Promise<{ float: number; amount: number; name: string }> {
  const found = await lookupCode(agentId, code);

  return prisma.$transaction(async (tx) => {
    const before = await lockFloat(tx, agentId);

    const { count } = await tx.withdrawalRequest.updateMany({
      where: { id: found.id, status: "PENDING", withdrawalAgentId: agentId },
      data: { status: "APPROVED", paidAt: new Date(), adminNote: "Paid in cash at counter" },
    });
    // Someone else got there between the lookup and here.
    if (count === 0) throw new CashError("CODE_ALREADY_USED");

    const req = await tx.withdrawalRequest.findUniqueOrThrow({
      where: { id: found.id },
      select: { userId: true, amount: true, txnReference: true },
    });
    // The player's balance was already debited when they requested it; this
    // closes the PENDING ledger row that reserved it.
    await closeWithdrawalTxn(tx, req, "COMPLETED");

    const agent = await tx.withdrawalAgent.findUniqueOrThrow({
      where: { id: agentId },
      select: { commissionRate: true },
    });

    await tx.withdrawalAgentTxn.create({
      data: { agentId, type: "CASH_PAYOUT", amount: found.amount, refId: found.id,
        note: `Cash paid to account ${found.accountNo}` },
    });

    const earned = commissionOn(found.amount, Number(agent.commissionRate));
    if (earned > 0) {
      await tx.withdrawalAgentTxn.create({
        data: { agentId, type: "CASH_COMMISSION", amount: earned, refId: found.id,
          note: `${Number(agent.commissionRate)}% of ${found.amount} paid out` },
      });
    }

    return { float: roundETB(before + found.amount), amount: found.amount, name: found.name };
  }, { timeout: 20_000 });
}
