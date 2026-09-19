import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyHmacSignature, roundETB } from "@/lib/utils";
import { getRewardConfig } from "@/lib/rewardConfig";
import { dayIndexUtc, awardPoints } from "@/lib/loyalty";
import { settleRound, withdrawable, credit } from "@/lib/wallet";
import { attachBetToOpenTicket, settleTicketBet, agentCommission } from "@/lib/tickets";
import { SilentApiCallbackPayload, SilentApiCallbackResponse } from "@/types";
import { TransactionType } from "@prisma/client";
import { publishBalanceEvent } from "@/lib/balanceEvents";

function resolveTransactionType(betETB: number, winETB: number): TransactionType {
  if (betETB > 0 && winETB === 0) return "BET";
  if (winETB > 0 && betETB === 0) return "WIN";
  // Combined round (bet + win in same event) — classify by net direction
  return winETB >= betETB ? "WIN" : "BET";
}

export async function POST(req: NextRequest) {
  try {
    // 1. Read raw body before any parsing (signature is over the exact bytes received)
    const rawBody = await req.text();
    const signature = req.headers.get("x-signature") ?? "";

    // 2. Verify HMAC-SHA256 — timing-safe via crypto.subtle.verify.
    //
    // Two secrets are accepted while we move to our own Silent account. A round
    // launched on the old account settles here signed with the old key, and the
    // new account signs with the new one, so for as long as both can arrive we
    // have to take either — rejecting a win callback means a player who won and
    // never got paid. Unset SILENT_API_SECRET_KEY_PREVIOUS once the old
    // account's rounds have drained and this collapses back to one key.
    let isValid = false;
    for (const secret of [
      process.env.SILENT_API_SECRET_KEY,
      process.env.SILENT_API_SECRET_KEY_PREVIOUS,
    ]) {
      if (secret && (await verifyHmacSignature(rawBody, signature, secret))) {
        isValid = true;
        break;
      }
    }

    if (!isValid) {
      return NextResponse.json({ code: 401, msg: "Invalid Signature" }, { status: 401 });
    }

    // 3. Parse after verification
    const payload: SilentApiCallbackPayload = JSON.parse(rawBody);
    const { serial_number, member_account, win_amount, bet_amount } = payload;

    const winETB = parseFloat(win_amount);
    const betETB = parseFloat(bet_amount);

    // 4. Idempotency — duplicate serial_number means already processed
    const existing = await prisma.transaction.findUnique({
      where: { reference: serial_number },
      include: { user: { select: { balance: true } } },
    });
    if (existing) {
      const response: SilentApiCallbackResponse = {
        code: 0,
        msg: "Success",
        balance: Number(existing.user.balance),
      };
      return NextResponse.json(response);
    }

    // 5. Lookup player by member_account (= username)
    const user = await prisma.user.findUnique({
      where: { username: member_account },
    });

    if (!user) {
      return NextResponse.json({ code: 404, msg: "User not found" }, { status: 404 });
    }

    // 6. Compute net balance change
    //    win_amount → ADD to balance
    //    bet_amount → DEDUCT from balance
    const netChange = roundETB(winETB - betETB);
    const newBalance = roundETB(Number(user.balance) + netChange);

    // Guard before settling: the stake can't exceed what's playable.
    if (betETB > Number(user.balance) || newBalance < 0) {
      return NextResponse.json({ code: 402, msg: "Insufficient balance" }, { status: 200 });
    }

    const { pointsEconomy } = await getRewardConfig();

    // Loyalty points (lifetime XP → drives Level): points per ETB staked plus a
    // win bonus. Points only ever increase.
    const pointsEarned =
      Math.round(betETB * pointsEconomy.pointsPerEtbWagered) + Math.round(winETB * pointsEconomy.winBonusPct);

    // Daily-play streak: a real bet (bet_amount > 0) on a new calendar day
    // advances the streak and earns the daily-play bonus. `lastSeenAt` marks the
    // last play day. Idempotency (step 4) prevents replays from double-counting.
    const now = new Date();
    const today = dayIndexUtc(now);
    const lastPlayDay = user.lastSeenAt ? dayIndexUtc(user.lastSeenAt) : null;
    // Only a real bet (≥ minimum stake) on a new day advances the streak —
    // prevents farming the streak/daily bonus with penny bets.
    const isNewPlayDay = betETB >= pointsEconomy.minStreakBet && lastPlayDay !== today;
    const streakUpdate = isNewPlayDay
      ? { streakDays: lastPlayDay === today - 1 ? user.streakDays + 1 : 1, lastSeenAt: now }
      : {};
    const dailyBonus = isNewPlayDay ? pointsEconomy.dailyPlayPoints : 0;
    const totalPoints = pointsEarned + dailyBonus;

    // Settle the round against the pots: the stake drains deposit → bonus →
    // withdrawable, and a win of at least 1.1× the stake lands wholly in
    // withdrawable. Anything under that bar goes back to the pots that funded
    // it. That is the only way funds ever become withdrawable — there is no
    // wagering counter.
    const settled = settleRound(
      {
        balance: Number(user.balance),
        depositBalance: Number(user.depositBalance),
        bonusBalance: Number(user.bonusBalance),
      },
      betETB,
      winETB,
    );

    // In-person agent extras. Commission is a percent of the stake, credited
    // to withdrawable as its own COMMISSION row so the ledger shows it
    // separately from the round settlement. Ticket bookkeeping links the BET
    // row to the agent's open draft (or settles one via game_round on a win).
    const commissionRate = user.role === "IN_PERSON_AGENT" ? Number(user.commissionRate ?? 0) : 0;
    const commissionAmt = betETB > 0 ? agentCommission(betETB, commissionRate) : 0;
    const finalWallet = commissionAmt > 0 ? credit(settled, commissionAmt, "withdrawable") : settled;

    // 7. Persist atomically
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          balance: finalWallet.balance,
          depositBalance: finalWallet.depositBalance,
          bonusBalance: finalWallet.bonusBalance,
          ...awardPoints(totalPoints),
          ...streakUpdate,
        },
      });
      const txn = await tx.transaction.create({
        data: {
          userId: user.id,
          type: resolveTransactionType(betETB, winETB),
          status: "COMPLETED",
          amount: Math.abs(netChange),
          balanceBefore: user.balance,
          balanceAfter: settled.balance,
          reference: serial_number,
          metadata: payload as object,
        },
      });
      if (commissionAmt > 0) {
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: "COMMISSION",
            status: "COMPLETED",
            amount: commissionAmt,
            balanceBefore: settled.balance,
            balanceAfter: finalWallet.balance,
            reference: `${serial_number}:commission`,
            metadata: { stake: betETB, ratePct: commissionRate, serial: serial_number },
          },
        });
      }
      if (user.role === "IN_PERSON_AGENT") {
        if (betETB > 0) {
          // Pure bet or combined round — attach to the open ticket draft.
          await attachBetToOpenTicket(tx, user.id, txn.id, betETB, payload.game_round ?? null, winETB);
        } else if (winETB > 0) {
          // Pure win — settle the matching ticket bet by provider round id.
          await settleTicketBet(tx, user.id, payload.game_round ?? null, winETB);
        }
      }
    });

    // Push the new balance to the player's live wallet stream
    await publishBalanceEvent(user.id, {
      balance: finalWallet.balance,
      withdrawable: withdrawable(finalWallet),
      reason: winETB > betETB ? "win" : "bet",
      amount: Math.abs(netChange),
    });

    // 8. Respond with updated balance (provider requires exactly this shape)
    const response: SilentApiCallbackResponse = {
      code: 0,
      msg: "Success",
      balance: finalWallet.balance,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[provider/wallet/callback]", error);
    return NextResponse.json({ code: 500, msg: "Internal Server Error" }, { status: 500 });
  }
}
