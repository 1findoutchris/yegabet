import { NextRequest, NextResponse } from "next/server";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyHmacSignature, roundETB } from "@/lib/utils";
import { getRewardConfig } from "@/lib/rewardConfig";
import { dayIndexUtc, awardPoints } from "@/lib/loyalty";
import { settleRound, withdrawable, credit, type Wallet } from "@/lib/wallet";
import { attachBetToOpenTicket, settleTicketBet, agentCommission } from "@/lib/tickets";
import { publishBalanceEvent } from "@/lib/balanceEvents";

/**
 * Gregmorn Hub seamless-wallet callbacks.
 *
 * One URL (configured per-currency in their panel) receives three commands:
 *   getBalance — mid-session balance check; 400 here means "don't spin"
 *   writeBet   — settle a round (bet debit + win credit in one call)
 *   rollback   — void a round; REUSES the original bet's transactionId
 *
 * Auth: X-Signature = hex HMAC-SHA256 over the raw body, keyed by the Vinnabet
 * sub-user's secret_api_key — same scheme we sign openGame with.
 * `login` echoes the player_login we sent at launch (= our user.id).
 * `sessionid` must match a GameSession row created at launch.
 *
 * Money safety:
 *   - Every mutation runs in one DB transaction holding a row lock on the
 *     player (SELECT … FOR UPDATE), so parallel callbacks for the same player
 *     serialize — no lost updates, no overdraw.
 *   - The idempotency check happens AFTER taking the lock, so a retry racing
 *     its original sees the committed row; a unique-violation fallback covers
 *     anything that still slips through.
 *   - References are namespaced `gm:` — the column is shared with deposits
 *     and Silent serials.
 *   - Rollback reverses the wallet snapshot recorded at settle time, never the
 *     amounts the rollback request claims.
 */

interface CallbackPayload {
  cmd: "getBalance" | "writeBet" | "rollback";
  login: string;
  sessionid: string;
  bet?: number | string;
  win?: number | string;
  transactionId?: string | number;
  roundId?: string;
  round_finished?: boolean | string;
  gameId?: string;
  info?: unknown;
}

type Tx = Prisma.TransactionClient;
type BalanceEvent = Parameters<typeof publishBalanceEvent>[1];

const ref = (transactionId: string | number) => `gm:${transactionId}`;

function ok(login: string, balance: number) {
  return NextResponse.json({
    status: "success",
    balance: roundETB(balance),
    currency: "ETB",
    error: "",
    login,
  });
}

function fail(httpStatus: number, error: string, login = "") {
  return NextResponse.json(
    { status: "fail", balance: 0, currency: "ETB", error, login },
    { status: httpStatus }
  );
}

/** Amounts arrive as string OR number. Missing → 0; garbage/negative → null. */
function parseAmount(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return roundETB(n);
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Row-lock the player for the rest of the transaction, then read them. */
async function lockUser(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${id} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id } });
}

function walletOf(u: { balance: unknown; depositBalance: unknown; bonusBalance: unknown }): Wallet {
  return {
    balance: Number(u.balance),
    depositBalance: Number(u.depositBalance),
    bonusBalance: Number(u.bonusBalance),
  };
}

function resolveTransactionType(betETB: number, winETB: number): TransactionType {
  if (betETB > 0 && winETB === 0) return "BET";
  if (winETB > 0 && betETB === 0) return "WIN";
  return winETB >= betETB ? "WIN" : "BET";
}

export async function POST(req: NextRequest) {
  try {
    // 1. Signature over the exact bytes received
    const rawBody = await req.text();
    const signature = req.headers.get("x-signature") ?? "";
    const secret = process.env.GREGMORN_SECRET_KEY ?? "";
    if (!secret || !(await verifyHmacSignature(rawBody, signature, secret))) {
      return fail(401, "invalid signature");
    }

    let payload: CallbackPayload;
    try {
      payload = JSON.parse(rawBody) as CallbackPayload;
    } catch {
      return fail(400, "invalid json");
    }
    const { cmd, login, sessionid } = payload;
    if (typeof login !== "string" || !login) return fail(400, "missing login");

    // 2. Player + session — login is the player_login we sent (user.id)
    const user = await prisma.user.findUnique({ where: { id: login } });
    if (!user) return fail(404, "user not found", login);

    const session = await prisma.gameSession.findUnique({
      where: { sessionId: String(sessionid ?? "") },
    });
    if (!session || session.userId !== user.id) {
      return fail(400, "session not found", login);
    }

    switch (cmd) {
      case "getBalance":
        return ok(login, Number(user.balance));
      case "writeBet":
        return await handleWriteBet(payload, user.id);
      case "rollback":
        return await handleRollback(payload, user.id);
      default:
        return fail(400, `unknown cmd: ${String(cmd)}`, login);
    }
  } catch (error) {
    console.error("[provider/gregmorn/callback]", error);
    return fail(500, "internal error");
  }
}

// ── writeBet ──────────────────────────────────────────────────────────────────

type WriteOutcome =
  | { kind: "ok"; balance: number; event?: BalanceEvent }
  | { kind: "insufficient" };

async function handleWriteBet(payload: CallbackPayload, userId: string) {
  const { login, transactionId } = payload;
  const betETB = parseAmount(payload.bet);
  const winETB = parseAmount(payload.win);
  if (betETB === null || winETB === null) return fail(400, "invalid amount", login);
  if (transactionId === undefined || transactionId === "") {
    return fail(400, "missing transactionId", login);
  }

  const reference = ref(transactionId);
  const { pointsEconomy } = await getRewardConfig();
  // Ticket bookkeeping keys on the provider round id; fall back to sessionid
  // for providers that omit roundId.
  const roundRef = payload.roundId ?? String(payload.sessionid);

  let outcome: WriteOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<WriteOutcome> => {
      const user = await lockUser(tx, userId);

      // Idempotent on transactionId — checked under the lock.
      const existing = await tx.transaction.findUnique({ where: { reference } });
      if (existing) return { kind: "ok", balance: Number(user.balance) };

      const before = walletOf(user);
      if (betETB > before.balance) return { kind: "insufficient" };

      const pointsEarned =
        Math.round(betETB * pointsEconomy.pointsPerEtbWagered) +
        Math.round(winETB * pointsEconomy.winBonusPct);
      const now = new Date();
      const today = dayIndexUtc(now);
      const lastPlayDay = user.lastSeenAt ? dayIndexUtc(user.lastSeenAt) : null;
      const isNewPlayDay = betETB >= pointsEconomy.minStreakBet && lastPlayDay !== today;
      const streakUpdate = isNewPlayDay
        ? { streakDays: lastPlayDay === today - 1 ? user.streakDays + 1 : 1, lastSeenAt: now }
        : {};
      const totalPoints = pointsEarned + (isNewPlayDay ? pointsEconomy.dailyPlayPoints : 0);

      const settled = settleRound(before, betETB, winETB);
      const commissionRate =
        user.role === "IN_PERSON_AGENT" ? Number(user.commissionRate ?? 0) : 0;
      const commissionAmt = betETB > 0 ? agentCommission(betETB, commissionRate) : 0;
      const after = commissionAmt > 0 ? credit(settled, commissionAmt, "withdrawable") : settled;
      const netChange = roundETB(winETB - betETB);

      await tx.user.update({
        where: { id: user.id },
        data: {
          balance: after.balance,
          depositBalance: after.depositBalance,
          bonusBalance: after.bonusBalance,
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
          balanceBefore: before.balance,
          balanceAfter: settled.balance,
          reference,
          // Wallet snapshot lets rollback reverse the exact pot movements
          // (incl. agent commission) instead of guessing.
          metadata: { ...payload, wallet: { before, after } } as object,
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
            balanceAfter: after.balance,
            reference: `${reference}:commission`,
            metadata: { stake: betETB, ratePct: commissionRate, serial: reference },
          },
        });
      }
      if (user.role === "IN_PERSON_AGENT") {
        if (betETB > 0) {
          await attachBetToOpenTicket(
            tx, user.id, txn.id, betETB, roundRef, winETB,
            payload.gameId ?? null, payload.info
          );
        } else if (winETB > 0) {
          await settleTicketBet(tx, user.id, roundRef, winETB);
        }
      }

      return {
        kind: "ok",
        balance: after.balance,
        event: {
          balance: after.balance,
          withdrawable: withdrawable(after),
          reason: winETB > betETB ? "win" : "bet",
          amount: Math.abs(netChange),
        },
      };
    });
  } catch (e) {
    // A duplicate that raced past the lock (e.g. user row created mid-flight)
    // — the original committed, so answer with the current balance.
    if (!isUniqueViolation(e)) throw e;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return ok(login, Number(u.balance));
  }

  if (outcome.kind === "insufficient") return fail(400, "insufficient funds", login);
  if (outcome.event) await publishBalanceEvent(userId, outcome.event);
  return ok(login, outcome.balance);
}

// ── rollback ──────────────────────────────────────────────────────────────────
// transactionId is the ORIGINAL writeBet's id. The original must exist and
// belong to this player, and a `:rollback` marker must not exist yet. The
// reversal applies the inverse of the recorded wallet movement, clamped so no
// pot goes negative if the player already spent the winnings.

async function handleRollback(payload: CallbackPayload, userId: string) {
  const { login, transactionId } = payload;
  if (transactionId === undefined || transactionId === "") {
    return fail(400, "missing transactionId", login);
  }

  const reference = ref(transactionId);
  const rollbackRef = `${reference}:rollback`;

  let result: { balance: number; event?: BalanceEvent };
  try {
    result = await prisma.$transaction(async (tx) => {
      const user = await lockUser(tx, userId);
      const current = walletOf(user);

      const done = await tx.transaction.findUnique({ where: { reference: rollbackRef } });
      const original = await tx.transaction.findUnique({ where: { reference } });
      // Already rolled back, nothing to roll back, or not this player's round —
      // answer success with the current balance so the provider stops retrying.
      if (done || !original || original.userId !== user.id) {
        return { balance: current.balance };
      }

      const snap = (original.metadata as { wallet?: { before: Wallet; after: Wallet } } | null)
        ?.wallet;
      if (!snap) return { balance: current.balance };

      const balance = roundETB(
        Math.max(0, current.balance + (snap.before.balance - snap.after.balance))
      );
      const depositBalance = roundETB(
        Math.min(
          balance,
          Math.max(0, current.depositBalance + (snap.before.depositBalance - snap.after.depositBalance))
        )
      );
      const bonusBalance = roundETB(
        Math.min(
          balance - depositBalance,
          Math.max(0, current.bonusBalance + (snap.before.bonusBalance - snap.after.bonusBalance))
        )
      );
      const reversed: Wallet = { balance, depositBalance, bonusBalance };
      const moved = roundETB(Math.abs(reversed.balance - current.balance));

      await tx.user.update({
        where: { id: user.id },
        data: reversed,
      });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "REFUND",
          status: "COMPLETED",
          amount: moved,
          balanceBefore: current.balance,
          balanceAfter: reversed.balance,
          reference: rollbackRef,
          metadata: { ...payload, rolledBackTransaction: reference } as object,
        },
      });

      return {
        balance: reversed.balance,
        event: {
          balance: reversed.balance,
          withdrawable: withdrawable(reversed),
          reason: "adjust" as const,
          amount: moved,
        },
      };
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return ok(login, Number(u.balance));
  }

  if (result.event) await publishBalanceEvent(userId, result.event);
  return ok(login, result.balance);
}
