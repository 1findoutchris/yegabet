import { NextRequest, NextResponse } from "next/server";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundETB } from "@/lib/utils";
import { getRewardConfig } from "@/lib/rewardConfig";
import { dayIndexUtc, awardPoints } from "@/lib/loyalty";
import { settleRound, withdrawable, type Wallet } from "@/lib/wallet";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { WALLET_MAX_SKEW_S, verifyWalletSignature } from "@/lib/providers/octhera";
import { OCTHERA_ID_PREFIX } from "@/types/games";

/**
 * Octhera API v2 company wallet — set as the "Wallet URL" on Octhera's API
 * keys page: https://vinna.bet/api/provider/octhera/wallet
 *
 * Octhera POSTs signed JSON; we always answer HTTP 200 + JSON (anything else
 * is "unusable" to them and turns a bet into a rollback):
 *   ping     — connectivity test from the portal. Moves nothing.
 *   debit    — bet / bet_win. Authorize within 3 s: needs
 *              max(0, bet − win) available; balance moves by win − bet.
 *   credit   — win / refund. Add winAmount once, but only for a round whose
 *              bet we took (an applied, not rolled back debit with the same
 *              gameRound); anything else is TXN_NOT_FOUND, stored, never paid
 *              automatically. Never refused for a blocked player.
 *   rollback — undo a debit that may or may not have reached us. Reuses the
 *              debit's txnId. If the debit never arrived, the rollback row
 *              is a marker and a late debit gets TXN_ROLLED_BACK.
 *
 * Money safety (same approach as the Gregmorn wallet):
 *   - Every mutation runs in one DB transaction holding a row lock on the
 *     player, so parallel calls for one player serialize.
 *   - Idempotency on (type, txnId) in octhera_wallet_txns, checked under the
 *     lock; a retry gets the exact stored response. Failed credits/rollbacks
 *     (PLAYER_NOT_FOUND) are NOT stored, so a later retry can succeed.
 *   - Rollback reverses the wallet snapshot recorded on the debit, never the
 *     amounts the rollback claims.
 */

type Tx = Prisma.TransactionClient;
type BalanceEvent = Parameters<typeof publishBalanceEvent>[1];
type WalletResponse =
  | { status: "ok"; balance?: number }
  | { status: "error"; code: string; balance?: number };

interface WalletCall {
  version: number;
  type: "debit" | "credit" | "rollback";
  txnId: string;
  playerId: string;
  currency: string;
  betAmount: number;
  winAmount: number;
  action: string | null;
  gameUid: string | null;
  gameName: string | null;
  gameRound: string | null;
  occurredAt: string | null;
  reason: string | null;
}

const CURRENCY = () => process.env.OCTHERA_CURRENCY || "ETB";

const reply = (body: WalletResponse) => NextResponse.json(body, { status: 200 });
const error = (code: string, balance?: number): WalletResponse =>
  balance === undefined ? { status: "error", code } : { status: "error", code, balance: roundETB(balance) };
const ok = (balance?: number): WalletResponse =>
  balance === undefined ? { status: "ok" } : { status: "ok", balance: roundETB(balance) };

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** Major units, ≥ 0, at most two decimals. */
function amount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return null;
  return roundETB(v);
}

function parseCall(raw: unknown): WalletCall | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const type = b.type;
  if (b.version !== 2 || (type !== "debit" && type !== "credit" && type !== "rollback")) return null;
  const txnId = str(b.txnId);
  const playerId = str(b.playerId);
  const currency = str(b.currency);
  const betAmount = amount(b.betAmount);
  const winAmount = amount(b.winAmount);
  if (!txnId || txnId.length > 200 || !playerId || !currency || betAmount === null || winAmount === null) return null;
  const action = str(b.action);
  if (type === "debit" && action !== "bet" && action !== "bet_win") return null;
  if (type === "credit" && action !== "win" && action !== "refund") return null;
  return {
    version: 2, type, txnId, playerId, currency, betAmount, winAmount, action,
    gameUid: str(b.gameUid), gameName: str(b.gameName), gameRound: str(b.gameRound),
    occurredAt: str(b.occurredAt), reason: str(b.reason),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Row-lock the player for the rest of the transaction, then read them. */
async function lockUser(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${id} FOR UPDATE`;
  return tx.user.findUnique({ where: { id } });
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

const reference = (c: WalletCall) => `oc:${c.type}:${c.txnId}`;

async function stored(db: Tx | typeof prisma, type: string, txnId: string) {
  const row = await db.octheraWalletTxn.findUnique({ where: { type_txnId: { type, txnId } } });
  return row ? (row.response as WalletResponse) : null;
}

function record(tx: Tx, c: WalletCall, applied: boolean, response: WalletResponse, raw: unknown) {
  return tx.octheraWalletTxn.create({
    data: {
      type: c.type,
      txnId: c.txnId,
      playerId: c.playerId,
      action: c.action,
      betAmount: c.betAmount,
      winAmount: c.winAmount,
      applied,
      response: response as object,
      gameUid: c.gameUid,
      gameRound: c.gameRound,
      payload: raw as object,
    },
  });
}

/** Metadata shared by the Transaction rows, so history pages can name the game. */
const txnMeta = (c: WalletCall, raw: unknown, extra: object) => ({
  ...(raw as object),
  provider: "octhera",
  gameId: c.gameUid ? `${OCTHERA_ID_PREFIX}${c.gameUid}` : null,
  ...extra,
});

/**
 * One Railway log line per wallet call, so "is Octhera calling our wallet, and
 * what do we answer?" can be read from the logs. No line at all after playing
 * a round means Octhera never called us (portal Wallet URL / account mode).
 */
function log(what: string, response: WalletResponse, detail = "") {
  const answer = response.status === "ok" ? "ok" : response.code;
  const balance = response.balance === undefined ? "" : ` balance=${response.balance}`;
  console.info(`[octhera-wallet] ${what} → ${answer}${balance}${detail ? ` (${detail})` : ""}`);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const timestamp = req.headers.get("x-octhera-timestamp") ?? "";
    if (!verifyWalletSignature(rawBody, timestamp, req.headers.get("x-octhera-signature") ?? "")) {
      const response = error("INVALID_SIGNATURE");
      const why = !process.env.OCTHERA_WALLET_SECRET
        ? "OCTHERA_WALLET_SECRET is not set"
        : /^\d{1,12}$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) > WALLET_MAX_SKEW_S
          ? `timestamp ${timestamp} is more than ${WALLET_MAX_SKEW_S}s off`
          : "signature doesn't match OCTHERA_WALLET_SECRET";
      log("call", response, why);
      return reply(response);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      log("call", error("INVALID_REQUEST"), "body is not JSON");
      return reply(error("INVALID_REQUEST"));
    }
    if ((raw as { type?: unknown })?.type === "ping") {
      log("ping", ok());
      return reply(ok());
    }

    const call = parseCall(raw);
    if (!call || call.currency !== CURRENCY()) {
      const b = raw as Record<string, unknown>;
      const why = call
        ? `currency ${call.currency}, this site uses ${CURRENCY()} (OCTHERA_CURRENCY)`
        : `unrecognized call: type=${String(b?.type)} action=${String(b?.action)}`;
      log("call", error("INVALID_REQUEST"), why);
      return reply(error("INVALID_REQUEST"));
    }

    const result =
      call.type === "debit" ? await debit(call, raw)
      : call.type === "credit" ? await credit(call, raw)
      : await rollback(call, raw);

    log(
      `${call.type}${call.action ? `/${call.action}` : ""} txn=${call.txnId} player=${call.playerId} bet=${call.betAmount} win=${call.winAmount}`,
      result.response
    );
    if (result.event) await publishBalanceEvent(call.playerId, result.event).catch(() => {});
    return reply(result.response);
  } catch (e) {
    // A non-200 is "unusable" to Octhera: a debit becomes a rollback, a
    // credit/rollback is retried. Both are safe.
    console.error("[provider/octhera/wallet]", e);
    return NextResponse.json({ status: "error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

type Result = { response: WalletResponse; event?: BalanceEvent };

/** Run a wallet mutation; if a duplicate raced past the lock, replay what it stored. */
async function once(c: WalletCall, fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const prior = await stored(prisma, c.type, c.txnId);
    if (!prior) throw e;
    return { response: prior };
  }
}

// ── debit: bet / bet_win ─────────────────────────────────────────────────────

async function debit(c: WalletCall, raw: unknown): Promise<Result> {
  const { pointsEconomy } = await getRewardConfig();

  return once(c, () =>
    prisma.$transaction(async (tx): Promise<Result> => {
      const user = await lockUser(tx, c.playerId);
      if (!user) return { response: error("PLAYER_NOT_FOUND") }; // not stored: nothing to replay

      const prior = await stored(tx, "debit", c.txnId);
      if (prior) return { response: prior };

      const before = walletOf(user);
      const refuse = async (code: string) => {
        const response = error(code, before.balance);
        await record(tx, c, false, response, raw);
        return { response };
      };

      if (await stored(tx, "rollback", c.txnId)) return refuse("TXN_ROLLED_BACK");
      if (!user.isActive) return refuse("PLAYER_BLOCKED");
      if (Math.max(0, c.betAmount - c.winAmount) > before.balance) return refuse("INSUFFICIENT_FUNDS");

      const bet = c.betAmount;
      const win = c.winAmount;
      const after = settleRound(before, bet, win);

      // Loyalty points and the daily-play streak, as for every other provider.
      const now = new Date();
      const today = dayIndexUtc(now);
      const lastPlayDay = user.lastSeenAt ? dayIndexUtc(user.lastSeenAt) : null;
      const isNewPlayDay = bet >= pointsEconomy.minStreakBet && lastPlayDay !== today;
      const streakUpdate = isNewPlayDay
        ? { streakDays: lastPlayDay === today - 1 ? user.streakDays + 1 : 1, lastSeenAt: now }
        : {};
      const points =
        Math.round(bet * pointsEconomy.pointsPerEtbWagered) +
        Math.round(win * pointsEconomy.winBonusPct) +
        (isNewPlayDay ? pointsEconomy.dailyPlayPoints : 0);

      await tx.user.update({
        where: { id: user.id },
        data: {
          balance: after.balance,
          depositBalance: after.depositBalance,
          bonusBalance: after.bonusBalance,
          ...awardPoints(points),
          ...streakUpdate,
        },
      });
      const net = roundETB(win - bet);
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: resolveTransactionType(bet, win),
          status: "COMPLETED",
          amount: Math.abs(net),
          balanceBefore: before.balance,
          balanceAfter: after.balance,
          reference: reference(c),
          // The wallet snapshot lets a rollback reverse the exact pot movements.
          metadata: txnMeta(c, raw, { wallet: { before, after } }),
        },
      });
      const response = ok(after.balance);
      await record(tx, c, true, response, raw);

      return {
        response,
        event: {
          balance: after.balance,
          withdrawable: withdrawable(after),
          reason: win > bet ? "win" : "bet",
          amount: Math.abs(net),
        },
      };
    })
  );
}

// ── credit: win / refund ─────────────────────────────────────────────────────

/** This player has an applied debit in the credit's gameRound that wasn't rolled back. */
async function roundIsBacked(tx: Tx, c: WalletCall): Promise<boolean> {
  if (!c.gameRound) return false;
  const debits = await tx.octheraWalletTxn.findMany({
    where: { type: "debit", playerId: c.playerId, gameRound: c.gameRound, applied: true },
    select: { txnId: true },
  });
  if (debits.length === 0) return false;
  const rolledBack = await tx.octheraWalletTxn.count({
    where: { type: "rollback", applied: true, txnId: { in: debits.map((d) => d.txnId) } },
  });
  return rolledBack < debits.length;
}

async function credit(c: WalletCall, raw: unknown): Promise<Result> {
  return once(c, () =>
    prisma.$transaction(async (tx): Promise<Result> => {
      // Unknown player: answer an error but store nothing — Octhera retries
      // credits for 72 h, and a retry must be able to succeed.
      const user = await lockUser(tx, c.playerId);
      if (!user) return { response: error("PLAYER_NOT_FOUND") };

      const prior = await stored(tx, "credit", c.txnId);
      if (prior) return { response: prior };

      const before = walletOf(user);

      // Only pay a round we took the stake for. A win with no debit here was
      // staked somewhere else (e.g. while Octhera couldn't reach this wallet),
      // so paying it would hand out money the bet never cost. It is stored
      // (applied = false) as the list to reconcile by hand, and retries
      // replay the refusal. A blocked player still gets a backed win.
      if (!(await roundIsBacked(tx, c))) {
        const response = error("TXN_NOT_FOUND", before.balance);
        await record(tx, c, false, response, raw);
        return { response };
      }

      const win = c.winAmount;
      const after = win > 0 ? settleRound(before, 0, win) : before;
      if (win > 0) {
        await tx.user.update({
          where: { id: user.id },
          data: { balance: after.balance, depositBalance: after.depositBalance, bonusBalance: after.bonusBalance },
        });
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: c.action === "refund" ? "REFUND" : "WIN",
            status: "COMPLETED",
            amount: win,
            balanceBefore: before.balance,
            balanceAfter: after.balance,
            reference: reference(c),
            metadata: txnMeta(c, raw, { wallet: { before, after } }),
          },
        });
      }
      const response = ok(after.balance);
      await record(tx, c, win > 0, response, raw);

      return {
        response,
        event: win > 0
          ? { balance: after.balance, withdrawable: withdrawable(after), reason: "win", amount: win }
          : undefined,
      };
    })
  );
}

// ── rollback ─────────────────────────────────────────────────────────────────

async function rollback(c: WalletCall, raw: unknown): Promise<Result> {
  return once(c, () =>
    prisma.$transaction(async (tx): Promise<Result> => {
      const user = await lockUser(tx, c.playerId);

      const prior = await stored(tx, "rollback", c.txnId);
      if (prior) return { response: prior };

      const debitRow = await tx.octheraWalletTxn.findUnique({
        where: { type_txnId: { type: "debit", txnId: c.txnId } },
      });
      const original = debitRow?.applied
        ? await tx.transaction.findUnique({ where: { reference: `oc:debit:${c.txnId}` } })
        : null;
      const snap = (original?.metadata as { wallet?: { before: Wallet; after: Wallet } } | null)?.wallet;

      // No applied debit for this player (never arrived, was refused, or
      // isn't theirs): move nothing, and leave the marker so a late debit
      // with this txnId is refused.
      if (!user || !original || original.userId !== user.id || !snap) {
        const response = user ? ok(Number(user.balance)) : ok();
        await record(tx, c, false, response, raw);
        return { response };
      }

      // Reverse the recorded movement, clamped so no pot goes negative if the
      // player already spent a win.
      const current = walletOf(user);
      const balance = roundETB(Math.max(0, current.balance + (snap.before.balance - snap.after.balance)));
      const depositBalance = roundETB(
        Math.min(balance, Math.max(0, current.depositBalance + (snap.before.depositBalance - snap.after.depositBalance)))
      );
      const bonusBalance = roundETB(
        Math.min(balance - depositBalance, Math.max(0, current.bonusBalance + (snap.before.bonusBalance - snap.after.bonusBalance)))
      );
      const reversed: Wallet = { balance, depositBalance, bonusBalance };
      const moved = roundETB(Math.abs(reversed.balance - current.balance));

      await tx.user.update({ where: { id: user.id }, data: reversed });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "REFUND",
          status: "COMPLETED",
          amount: moved,
          balanceBefore: current.balance,
          balanceAfter: reversed.balance,
          reference: reference(c),
          metadata: txnMeta(c, raw, { rolledBackTransaction: original.reference }),
        },
      });
      const response = ok(reversed.balance);
      await record(tx, c, true, response, raw);

      return {
        response,
        event: { balance: reversed.balance, withdrawable: withdrawable(reversed), reason: "adjust", amount: moved },
      };
    })
  );
}
