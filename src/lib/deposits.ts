import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis, TTL_USED } from "@/lib/redis";
import { isoWeekStart, awardPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { grantBonus } from "@/lib/bonus";
import { quoteDepositBonus } from "@/lib/depositBonusCore";
import { withdrawable } from "@/lib/wallet";
import { sendPushToUser } from "@/lib/push";
import { formatCurrency } from "@/lib/utils";

export interface PendingDepositData {
  depositId: string;
  userId: string;
  method: string;
  submittedAt: string;
}

export interface AgentSmsData {
  amount: number;
  method: string | null;
  rawMessage: string;
  receivedAt: string;
}

/**
 * Credits the user's balance and marks the deposit request as APPROVED.
 * Uses a Redis SET NX lock on `used:ref:{ref}` as the first line of idempotency;
 * the unique DB constraint on `transactions.reference` is the second line.
 *
 * Returns false if the deposit was already processed (idempotent no-op).
 */
export async function approveDeposit(
  depositId: string,
  userId: string,
  amount: number,
  ref: string,
  /**
   * Runs inside the crediting transaction, before any money moves. Throwing
   * from here rolls the whole credit back.
   *
   * This exists for the cash rail: an agent's float has to be debited in the
   * same transaction that credits the player, or a crash between the two leaves
   * either a player paid from nothing or an agent charged for nothing. Callers
   * on the SMS rail pass nothing and are unaffected.
   */
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<boolean> {
  // Atomic idempotency gate — only the first caller wins
  const lock = await redis.set(`used:ref:${ref}`, "1", "EX", TTL_USED, "NX");
  if (lock === null) return false; // already approved

  // Clean up pending keys
  await Promise.all([
    redis.del(`pending:ref:${ref}`),
    redis.del(`sms:ref:${ref}`),
  ]);

  const { pointsEconomy, depositBonus } = await getRewardConfig();

  // The lock is taken before the transaction, so a transaction that fails would
  // otherwise burn the reference forever and leave the deposit permanently
  // un-approvable — every retry returning "already approved" for money that was
  // never credited. Release it on the way out and let the caller retry.
  try {
  await prisma.$transaction(async (tx) => {
    // Before anything is credited, so a rejected precondition costs nothing.
    await inTx?.(tx);

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    const before = Number(user?.balance ?? 0);
    const after = before + amount;

    const priorThisWeek = await tx.transaction.count({
      where: {
        userId,
        type: "DEPOSIT",
        status: "COMPLETED",
        createdAt: { gte: isoWeekStart() },
      },
    });
    const bonusPoints = priorThisWeek === 0 ? pointsEconomy.firstDepositOfWeekPoints : 0;

    // Unique reference prevents double-credit even if lock somehow races
    await tx.transaction.create({
      data: {
        userId,
        type: "DEPOSIT",
        status: "COMPLETED",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        reference: `dep-${ref}`,
        metadata: { smsRef: ref, depositRequestId: depositId },
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        balance: after,
        // A deposit is playable at once but not withdrawable — it turns into
        // withdrawable funds only by being staked and won back.
        depositBalance: { increment: amount },
        ...awardPoints(bonusPoints),
      },
    });

    await tx.depositRequest.update({
      where: { id: depositId },
      data: {
        status: "APPROVED",
        amount,
        adminNote: `Auto-matched SMS ref: ${ref}`,
      },
    });

    const completedDepositCount = await tx.transaction.count({
      where: { userId, type: "DEPOSIT", status: "COMPLETED" },
    });
    // count === 1 means the transaction we just created above is the only one
    const isFirstDeposit = completedDepositCount === 1;

    // ── Deposit bonus: welcome match and/or a running % promo ──────────────
    // Both rules can be on; the better one pays, never the sum, so the worst
    // case per deposit is the single most generous rule rather than however
    // many happen to be enabled. See depositBonusCore.
    const quote = quoteDepositBonus(amount, isFirstDeposit, depositBonus, new Date());
    if (quote.amount > 0) {
      await grantBonus(tx, {
        userId,
        amount: quote.amount,
        // Same idempotency guarantee as the deposit itself: one bonus per
        // approved deposit, enforced by the unique reference.
        reference: `dep-bonus-${ref}`,
        kind: "deposit_bonus",
        metadata: { rule: quote.rule, depositAmount: amount, depositRequestId: depositId },
      });
    }

    // A referrer earns nothing here. The referral reward is a prize-wheel spin,
    // granted when the friend completes an OTP-verified signup — see
    // grantSpinCreditForReferral in api/auth/register. Paying a % of the first
    // deposit as well would have been two rewards for one referral.
  }, {
    // ~10 round trips, plus whatever `inTx` adds. Prisma's 5s default is not a
    // budget this fits in when the database is a network hop away — it was
    // already close on the SMS rail, and the cash rail's float lock tipped it
    // over. A blown timeout here rolls back a deposit the player has already
    // paid for, so the ceiling is set well clear of the worst observed case.
    timeout: 20_000,
  });
  } catch (e) {
    await redis.del(`used:ref:${ref}`).catch(() => {});
    throw e;
  }

  // Notify any open SSE stream for this deposit — fire-and-forget
  redis
    .publish(`deposit:${depositId}`, JSON.stringify({ type: "approved", amount }))
    .catch(() => {});

  // Push the new wallet balance to the player's global balance stream so the
  // nav/account update live and a "deposit approved" toast can fire anywhere.
  const fresh = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true, depositBalance: true, bonusBalance: true },
  });
  if (fresh) {
    await publishBalanceEvent(userId, {
      balance: Number(fresh.balance),
      withdrawable: withdrawable({
        balance: Number(fresh.balance),
        depositBalance: Number(fresh.depositBalance),
        bonusBalance: Number(fresh.bonusBalance),
      }),
      reason: "deposit",
      amount,
    });
  }

  // Push "deposit confirmed" to the player's devices — fire-and-forget.
  sendPushToUser(userId, {
    title: "Deposit confirmed",
    body: `${formatCurrency(amount)} added to your balance.`,
    url: "/dashboard",
  }).catch(() => {});

  return true;
}
