import { roundETB } from "./utils";
import { credit, withdrawable, type Pot, type Wallet } from "./wallet";

/*
 * Pure pot math for admin balance adjustments.
 *
 * Free of `server-only` and prisma so adminAdjust.check.ts can exercise it —
 * this is a money path where an off-by-one either strands a player's funds or
 * hands out free withdrawals.
 */

export { POTS as BUCKETS, type Pot as Bucket } from "./wallet";

export const POT_LABEL: Record<Pot, string> = {
  withdrawable: "withdrawable funds",
  deposit: "deposit balance",
  bonus: "bonus balance",
};

export type AdjustResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** The targeted pot's own figure before the change (for the ledger row). */
      before: number;
      /** …and after. */
      after: number;
      update: Wallet;
    };

/** What the targeted pot currently holds. */
export function potValue(w: Wallet, pot: Pot): number {
  if (pot === "deposit") return w.depositBalance;
  if (pot === "bonus") return w.bonusBalance;
  return withdrawable(w);
}

/**
 * Work out the wallet writes for a signed adjustment against one pot.
 *
 * A credit raises the total and the named pot together. A deduction is capped
 * at what that pot actually holds, so an admin can never push a pot negative or
 * quietly claw money out of a different pot than the one they picked.
 */
export function applyAdjustment(w: Wallet, pot: Pot, amount: number): AdjustResult {
  const before = potValue(w, pot);

  if (amount >= 0) {
    const update = credit(w, amount, pot);
    return { ok: true, before, after: potValue(update, pot), update };
  }

  const magnitude = -amount;
  if (magnitude > before) {
    return { ok: false, error: `Not enough ${POT_LABEL[pot]} to deduct` };
  }

  // Withdrawable has no column of its own — lowering the total is what shrinks
  // it, which is why only the named pot is decremented alongside the balance.
  const update: Wallet = {
    balance: roundETB(w.balance - magnitude),
    depositBalance: pot === "deposit" ? roundETB(w.depositBalance - magnitude) : w.depositBalance,
    bonusBalance: pot === "bonus" ? roundETB(w.bonusBalance - magnitude) : w.bonusBalance,
  };
  return { ok: true, before, after: potValue(update, pot), update };
}
