import { roundETB } from "./utils";

/*
 * The wallet model, in one place.
 *
 *   balance = depositBalance + bonusBalance + withdrawable
 *
 * `balance` is total playable funds — the only figure the game provider sees.
 * Two of its three pots are stored; `withdrawable` is always derived, so the
 * three can never disagree with the total.
 *
 *   depositBalance — funded by deposits. Playable, not withdrawable.
 *   bonusBalance   — funded by bonuses.  Playable, not withdrawable.
 *   withdrawable   — won from gameplay.  Freely withdrawable.
 *
 * A bet drains deposit → bonus → withdrawable, so a player's winnings survive
 * as long as possible. A win lands wholly in withdrawable — but only if the
 * round paid at least QUALIFYING_MULTIPLIER times the stake.
 *
 * Pure and free of `server-only`/prisma so wallet.check.ts can exercise it.
 */

/**
 * How many times the stake a round must pay for its winnings to count as
 * withdrawable. Stake 10 → a return of 11 clears it, 10.20 does not.
 *
 * Without this bar, locked funds could be washed into cash at no risk: stake
 * the deposit on something that pays ~1.0× (both sides of a table, a 1.01×
 * crash cashout), lose a rounding error, and walk out with the rest as
 * withdrawable. Below the bar the money simply goes back to the pot it was
 * staked from.
 */
export const QUALIFYING_MULTIPLIER = 1.1;

export type Pot = "deposit" | "bonus" | "withdrawable";

export const POTS = ["withdrawable", "deposit", "bonus"] as const;

export interface Wallet {
  balance: number;
  depositBalance: number;
  bonusBalance: number;
}

/** The part of `balance` the player may actually cash out. */
export function withdrawable(w: Wallet): number {
  return roundETB(Math.max(0, w.balance - w.depositBalance - w.bonusBalance));
}

/**
 * How much of `amount` each locked pot funds, in drain order. Split out from
 * `debit` because settling a round needs to know where the stake came from to
 * put a non-qualifying win back.
 */
function drainSplit(w: Wallet, amount: number): { fromDeposit: number; fromBonus: number } {
  const fromDeposit = Math.min(w.depositBalance, roundETB(amount));
  const fromBonus = Math.min(w.bonusBalance, roundETB(amount - fromDeposit));
  return { fromDeposit, fromBonus };
}

/**
 * Spend `amount` of playable funds, draining deposit → bonus → withdrawable.
 * Caller must have already checked `amount <= w.balance`.
 */
export function debit(w: Wallet, amount: number): Wallet {
  const { fromDeposit, fromBonus } = drainSplit(w, amount);
  // Whatever remains comes out of withdrawable, which has no column of its own —
  // dropping `balance` is what shrinks it.
  return {
    balance: roundETB(w.balance - amount),
    depositBalance: roundETB(w.depositBalance - fromDeposit),
    bonusBalance: roundETB(w.bonusBalance - fromBonus),
  };
}

/** Add `amount` to a specific pot. Crediting "withdrawable" only raises the
 *  total, since withdrawable is the remainder. */
export function credit(w: Wallet, amount: number, pot: Pot): Wallet {
  return {
    balance: roundETB(w.balance + amount),
    depositBalance: pot === "deposit" ? roundETB(w.depositBalance + amount) : w.depositBalance,
    bonusBalance: pot === "bonus" ? roundETB(w.bonusBalance + amount) : w.bonusBalance,
  };
}

/**
 * Settle one provider round. The bet drains the pots in order; where the win
 * lands depends on how much the round paid.
 *
 * At or above QUALIFYING_MULTIPLIER × stake, the whole win is withdrawable and
 * the locked funds that staked it are cleared — the player took a real risk.
 * Below it, the win goes back to the pots the stake came from, deposit first,
 * so a near-1× round neither unlocks deposit money nor turns the player's own
 * withdrawable cash into locked funds.
 *
 * Bet and win are applied in that order so a round that stakes the last of a
 * pot and wins doesn't refill that pot with its own winnings.
 */
export function settleRound(w: Wallet, bet: number, win: number): Wallet {
  const afterBet = bet > 0 ? debit(w, bet) : w;
  if (win <= 0) return afterBet;

  // A credit with no stake (a bonus paid through the provider) has no
  // multiplier to judge, and is the player's cash by definition.
  if (bet <= 0 || win >= roundETB(bet * QUALIFYING_MULTIPLIER)) {
    return credit(afterBet, win, "withdrawable");
  }

  // Split the win the same way the stake was funded: a stake paid for entirely
  // out of the deposit pot returns to it in full, gains included — capping the
  // refund at the stake would hand the player the surplus as cash, which is the
  // penny-a-round leak this bar exists to close. A stake paid out of the
  // player's own cash returns to cash for the same reason.
  const { fromDeposit, fromBonus } = drainSplit(w, bet);
  const toDeposit = roundETB((win * fromDeposit) / bet);
  // Cumulative, so the rounding remainder can't leak a cent into withdrawable:
  // when the pots funded the whole stake this lands exactly on `win`.
  const toBonus = roundETB((win * (fromDeposit + fromBonus)) / bet) - toDeposit;
  const toWithdrawable = roundETB(win - toDeposit - toBonus);

  let out = afterBet;
  if (toDeposit > 0) out = credit(out, toDeposit, "deposit");
  if (toBonus > 0) out = credit(out, toBonus, "bonus");
  return toWithdrawable > 0 ? credit(out, toWithdrawable, "withdrawable") : out;
}
