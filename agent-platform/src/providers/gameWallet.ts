import { Prisma, PrismaClient } from "@prisma/client";
import { InsufficientFundsError } from "../ledger/errors";
import type { Ledger } from "../ledger/ledger";

/**
 * Provider-neutral seamless wallet (plan 07, CLAUDE.md §5.6). An adapter
 * (e.g. octhera/) verifies and parses a provider's call into a WalletCall,
 * runs it here, and formats the WalletResult back. Adding provider #2 means
 * a new adapter only.
 *
 * Money (Q-34, owner 2026-10-20): game money moves against the player's agent.
 *   bet       PLAYER_WALLET → AGENT_CASH_POSITION(agent)   (net, for bet_win)
 *   win       AGENT_CASH_POSITION(bet's agent) → PLAYER_WALLET
 *   rollback  the debit's posting, reversed
 * Every call runs in one DB transaction holding a row lock on the player, so
 * one player's calls serialize; (provider, type, txn_id) is the idempotency
 * key, and the stored answer is replayed on any retry.
 */

export interface WalletCall {
  provider: string;
  type: "debit" | "credit" | "rollback";
  txnId: string;
  /** Our player id, or null when the provider's player id doesn't map to one. */
  playerId: bigint | null;
  /** Santim. */
  bet: bigint;
  win: bigint;
  action: "bet" | "bet_win" | "win" | "refund" | null;
  gameUid: string | null;
  gameRound: string | null;
  payload: unknown;
}

export type WalletCode =
  "PLAYER_NOT_FOUND" | "PLAYER_BLOCKED" | "INSUFFICIENT_FUNDS" | "TXN_NOT_FOUND" | "TXN_ROLLED_BACK";

/** `balance` is the player's wallet in santim, when known. */
export type WalletResult = { ok: true; balance?: bigint } | { ok: false; code: WalletCode; balance?: bigint };

type Tx = Prisma.TransactionClient;

const ok = (balance?: bigint): WalletResult => (balance === undefined ? { ok: true } : { ok: true, balance });
const fail = (code: WalletCode, balance?: bigint): WalletResult =>
  balance === undefined ? { ok: false, code } : { ok: false, code, balance };

/** Stored as JSON, so bigint balances become strings. */
const toJson = (r: WalletResult) =>
  JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const fromJson = (j: Prisma.JsonValue): WalletResult => {
  const o = j as { ok: boolean; code?: WalletCode; balance?: string };
  const balance = o.balance === undefined ? undefined : BigInt(o.balance);
  return o.ok ? ok(balance) : fail(o.code as WalletCode, balance);
};

export class GameWallet {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
  ) {}

  async handle(call: WalletCall): Promise<WalletResult> {
    try {
      return await this.db.$transaction(
        (tx) =>
          call.type === "debit"
            ? this.debit(tx, call)
            : call.type === "credit"
              ? this.credit(tx, call)
              : this.rollback(tx, call),
        { timeout: 10_000, maxWait: 5_000 },
      );
    } catch (e) {
      // A duplicate that raced past the player lock (no player to lock): replay what won.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const prior = await this.prior(this.db, call.provider, call.type, call.txnId);
        if (prior) return fromJson(prior.response);
      }
      throw e;
    }
  }

  /** Bets still open for a player (withdrawal/transfer checks, Task 15). */
  async openBets(playerId: bigint): Promise<number> {
    return this.db.bet.count({ where: { playerId, status: "open" } });
  }

  /** Q-35: bets with no credit `hours` after they were placed are settled as lost. Returns how many. */
  async autoSettle(hours: number, now = new Date()): Promise<number> {
    const { count } = await this.db.bet.updateMany({
      where: { status: "open", placedAt: { lt: new Date(now.getTime() - hours * 3_600_000) } },
      data: { status: "settled", settledAt: now },
    });
    return count;
  }

  // ── Calls ─────────────────────────────────────────────────────────────────

  private async debit(tx: Tx, c: WalletCall): Promise<WalletResult> {
    const player = await this.lockPlayer(tx, c.playerId);
    if (!player) return fail("PLAYER_NOT_FOUND"); // not stored: nothing to replay
    const prior = await this.prior(tx, c.provider, "debit", c.txnId);
    if (prior) return fromJson(prior.response);

    const wallet = await this.account(tx, "PLAYER_WALLET", player.id);
    const before = await this.balance(tx, wallet);
    const refuse = async (code: WalletCode) => this.record(tx, c, player.id, false, fail(code, before), null);

    if (await this.prior(tx, c.provider, "rollback", c.txnId)) return refuse("TXN_ROLLED_BACK");
    if (player.status !== "active") return refuse("PLAYER_BLOCKED");

    const cash = await this.account(tx, "AGENT_CASH_POSITION", player.agentId);
    const net = c.win - c.bet;
    let ledgerTxnId: bigint | null = null;
    if (net !== 0n) {
      try {
        const posted = await this.ledger.postInTransaction(tx, {
          idempotencyKey: `${c.provider}:debit:${c.txnId}`,
          reason: net < 0n ? "game_bet" : "game_bet_win",
          referenceId: `${c.provider}:${c.gameRound ?? c.txnId}`,
          entries: [
            net < 0n
              ? { debitAccountId: wallet, creditAccountId: cash, amount: -net }
              : { debitAccountId: cash, creditAccountId: wallet, amount: net },
          ],
        });
        ledgerTxnId = posted.transaction.id;
      } catch (e) {
        if (e instanceof InsufficientFundsError) return refuse("INSUFFICIENT_FUNDS");
        throw e;
      }
    }
    const instant = c.action === "bet_win";
    await tx.bet.create({
      data: {
        providerId: c.provider,
        playerId: player.id,
        agentId: player.agentId, // §5.6 snapshot at bet time
        gameUid: c.gameUid,
        gameRound: c.gameRound,
        debitTxnId: c.txnId,
        stake: c.bet,
        win: instant ? c.win : 0n,
        status: instant ? "settled" : "open",
        settledAt: instant ? new Date() : null,
      },
    });
    return this.record(tx, c, player.id, true, ok(await this.balance(tx, wallet)), ledgerTxnId);
  }

  private async credit(tx: Tx, c: WalletCall): Promise<WalletResult> {
    const player = await this.lockPlayer(tx, c.playerId);
    // Not stored: providers retry credits for days, and a retry must be able to succeed.
    if (!player) return fail("PLAYER_NOT_FOUND");
    const priorRow = await this.prior(tx, c.provider, "credit", c.txnId);
    if (priorRow?.applied) return fromJson(priorRow.response);

    const wallet = await this.account(tx, "PLAYER_WALLET", player.id);
    const backing = await this.backing(tx, c, player.id);
    if (!backing) {
      // A win for a round whose stake we never took: kept for reconciliation, re-checked on every retry.
      const response = fail("TXN_NOT_FOUND", await this.balance(tx, wallet));
      if (!priorRow) await this.record(tx, c, player.id, false, response, null);
      return response;
    }

    let ledgerTxnId: bigint | null = null;
    if (c.win > 0n) {
      // Paid by the agent who took the bet (snapshot), even if the player moved since.
      const cash = await this.account(tx, "AGENT_CASH_POSITION", backing.agentId);
      const posted = await this.ledger.postInTransaction(tx, {
        idempotencyKey: `${c.provider}:credit:${c.txnId}`,
        reason: c.action === "refund" ? "game_refund" : "game_win",
        referenceId: `${c.provider}:${c.gameRound ?? c.txnId}`,
        entries: [{ debitAccountId: cash, creditAccountId: wallet, amount: c.win }],
      });
      ledgerTxnId = posted.transaction.id;
    }

    const now = new Date();
    if (backing.bets.length > 0) {
      const last = backing.bets[backing.bets.length - 1] as { id: bigint; win: bigint };
      for (const b of backing.bets) {
        await tx.bet.update({
          where: { id: b.id },
          data: { status: "settled", settledAt: now, ...(b.id === last.id ? { win: b.win + c.win } : {}) },
        });
      }
    } else if (c.win > 0n) {
      // Backed by a refused late bet: the provider sent the win net of the stake. Record it so settlement counts it.
      await tx.bet.create({
        data: {
          providerId: c.provider,
          playerId: player.id,
          agentId: backing.agentId,
          gameUid: c.gameUid,
          gameRound: c.gameRound,
          debitTxnId: `credit:${c.txnId}`,
          stake: 0n,
          win: c.win,
          status: "settled",
          settledAt: now,
        },
      });
    }

    const response = ok(await this.balance(tx, wallet));
    if (priorRow) {
      await tx.providerCall.update({
        where: { id: priorRow.id },
        data: {
          applied: true,
          response: toJson(response),
          payload: c.payload as object,
          ledgerTransactionId: ledgerTxnId,
        },
      });
      return response;
    }
    return this.record(tx, c, player.id, true, response, ledgerTxnId);
  }

  private async rollback(tx: Tx, c: WalletCall): Promise<WalletResult> {
    const player = await this.lockPlayer(tx, c.playerId);
    const prior = await this.prior(tx, c.provider, "rollback", c.txnId);
    if (prior) return fromJson(prior.response);

    const debit = await this.prior(tx, c.provider, "debit", c.txnId);
    const wallet = player ? await this.account(tx, "PLAYER_WALLET", player.id) : null;
    const balanceNow = async () => (wallet === null ? undefined : await this.balance(tx, wallet));

    // No applied debit (never arrived, refused, or not this player's): move nothing,
    // and leave the marker so a late debit with this txn id is refused.
    if (!player || !debit?.applied || debit.playerId !== player.id) {
      return this.record(tx, c, player?.id ?? null, false, ok(await balanceNow()), null);
    }

    let ledgerTxnId: bigint | null = null;
    if (debit.ledgerTransactionId !== null) {
      const original = await tx.ledgerEntry.findMany({
        where: { transactionId: debit.ledgerTransactionId },
        select: { debitAccountId: true, creditAccountId: true, amount: true },
      });
      // Reverse each leg. A reversal out of the wallet (rolling back a bet_win the
      // player already spent) is limited to what the wallet holds; the shortfall is
      // recorded for reconciliation instead of refusing the provider.
      let available = await this.balance(tx, wallet as bigint);
      const legs = [];
      let shortfall = 0n;
      for (const e of original) {
        let amount = e.amount;
        if (e.creditAccountId === wallet) {
          const take = amount < available ? amount : available;
          shortfall += amount - take;
          amount = take;
          available -= take;
        }
        if (amount > 0n)
          legs.push({ debitAccountId: e.creditAccountId, creditAccountId: e.debitAccountId, amount });
      }
      if (legs.length > 0) {
        const posted = await this.ledger.postInTransaction(tx, {
          idempotencyKey: `${c.provider}:rollback:${c.txnId}`,
          reason: "game_rollback",
          referenceId: `${c.provider}:${debit.gameRound ?? c.txnId}`,
          entries: legs,
        });
        ledgerTxnId = posted.transaction.id;
      }
      if (shortfall > 0n)
        c = { ...c, payload: { ...(c.payload as object), shortfallSantim: shortfall.toString() } };
    }
    await tx.bet.updateMany({
      where: { providerId: c.provider, debitTxnId: c.txnId, status: { not: "rolled_back" } },
      data: { status: "rolled_back", settledAt: new Date() },
    });
    return this.record(tx, c, player.id, true, ok(await balanceNow()), ledgerTxnId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Row-lock the player for the rest of the transaction (serializes their calls). */
  private async lockPlayer(tx: Tx, playerId: bigint | null) {
    if (playerId === null) return null;
    const rows = await tx.$queryRaw<
      { id: bigint }[]
    >`SELECT id FROM players WHERE id = ${playerId} FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { id: true, status: true, agentId: true },
    });
  }

  private prior(db: Tx | PrismaClient, provider: string, type: string, txnId: string) {
    return db.providerCall.findUnique({
      where: { providerId_type_txnId: { providerId: provider, type, txnId } },
    });
  }

  /**
   * What backs a credit: this player's bets in the same round that were taken
   * and not rolled back, or a late bet ("<txnId>:stake") we refused for funds or
   * a blocked account (the provider then sends the win net of the stake).
   */
  private async backing(tx: Tx, c: WalletCall, playerId: bigint) {
    if (c.gameRound) {
      const bets = await tx.bet.findMany({
        where: { providerId: c.provider, playerId, gameRound: c.gameRound, status: { not: "rolled_back" } },
        select: { id: true, win: true, agentId: true },
        orderBy: { id: "asc" },
      });
      if (bets.length > 0) return { agentId: (bets[bets.length - 1] as { agentId: bigint }).agentId, bets };
    }
    const late = await this.prior(tx, c.provider, "debit", `${c.txnId}:stake`);
    if (!late || late.applied || late.playerId !== playerId) return null;
    // A refused call always stores its code (see record()).
    const code = (late.response as { code: string }).code;
    if (code !== "INSUFFICIENT_FUNDS" && code !== "PLAYER_BLOCKED") return null;
    const p = await tx.player.findUniqueOrThrow({ where: { id: playerId }, select: { agentId: true } });
    return { agentId: p.agentId, bets: [] as { id: bigint; win: bigint; agentId: bigint }[] };
  }

  private async account(tx: Tx, type: "PLAYER_WALLET" | "AGENT_CASH_POSITION", ownerId: bigint) {
    const ownerKind = type === "PLAYER_WALLET" ? "player" : "agent";
    return (await this.ledger.openAccount({ type, ownerKind, ownerId: ownerId.toString() }, tx)).id;
  }

  private async balance(tx: Tx, accountId: bigint): Promise<bigint> {
    return (await tx.accountBalance.findUniqueOrThrow({ where: { accountId } })).balance;
  }

  private async record(
    tx: Tx,
    c: WalletCall,
    playerId: bigint | null,
    applied: boolean,
    response: WalletResult,
    ledgerTransactionId: bigint | null,
  ): Promise<WalletResult> {
    await tx.providerCall.create({
      data: {
        providerId: c.provider,
        type: c.type,
        txnId: c.txnId,
        playerId,
        action: c.action,
        gameUid: c.gameUid,
        gameRound: c.gameRound,
        betAmount: c.bet,
        winAmount: c.win,
        applied,
        response: toJson(response),
        payload: c.payload as object,
        ledgerTransactionId,
      },
    });
    return response;
  }
}
