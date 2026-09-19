import "server-only";
import type { Prisma } from "@prisma/client";
import { roundETB } from "./utils";

/*
 * The single way to grant credit outside of gameplay.
 *
 * Default (`pot: "bonus"`): the credit is part of `balance` — immediately
 * playable — but sits in the `bonusBalance` pot, which is excluded from what the
 * player can withdraw. It becomes withdrawable only by being staked and won
 * back, since winnings always land in the withdrawable pot.
 *
 * `pot: "withdrawable"` raises `balance` alone, which — because withdrawable is
 * derived as balance − depositBalance − bonusBalance — is real cash the player
 * can take out immediately. Only the prize wheel's headline prizes use it.
 * Kept in this function rather than a second money-minting helper so there
 * stays exactly one place where credit is created. See src/lib/wallet.ts.
 */

export type BonusKind =
  | "weekly_cashback"
  | "streak_milestone"
  // Retired — referrals pay a prize-wheel spin now, not a cut of the first
  // deposit. Kept so historical rows carrying this kind still typecheck.
  | "referral_first_deposit"
  | "points_redemption"
  | "spin_prize"
  | "deposit_bonus";

/** Which wallet pot the credit lands in. Mirrors `Pot` in src/lib/wallet.ts. */
export type GrantPot = "bonus" | "withdrawable";

export interface GrantBonusArgs {
  userId: string;
  /** ETB of credit to grant. */
  amount: number;
  /** Idempotency key — a repeat grant throws P2002, which callers map to 409. */
  reference: string;
  kind: BonusKind;
  metadata?: Record<string, unknown>;
  /** Defaults to "bonus", so every pre-existing caller is unchanged. */
  pot?: GrantPot;
}

/**
 * Credits the player's playable balance and writes its ledger row. Runs inside
 * the caller's `$transaction` so the grant commits together with whatever
 * triggered it.
 */
export async function grantBonus(
  tx: Prisma.TransactionClient,
  { userId, amount, reference, kind, metadata, pot = "bonus" }: GrantBonusArgs,
): Promise<{ amount: number }> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { balance: true },
  });
  const before = Number(user?.balance ?? 0);
  const after = roundETB(before + amount);

  await tx.transaction.create({
    data: {
      userId,
      type: "BONUS",
      status: "COMPLETED",
      amount,
      balanceBefore: before,
      balanceAfter: after,
      reference,
      // `kind` and `pot` are spread last so callers can't overwrite the
      // discriminators — BONUS rows are overloaded, and these are what tell
      // cashback, streak, referral, redemption and spin prizes apart, plus
      // whether the credit was withdrawable.
      metadata: { ...metadata, kind, pot },
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      balance: { increment: amount },
      // Raising bonusBalance alongside balance keeps the credit playable but
      // NOT withdrawable. Leaving it alone (pot: "withdrawable") means the
      // whole amount falls into the derived withdrawable pot.
      ...(pot === "bonus" ? { bonusBalance: { increment: amount } } : {}),
    },
  });

  return { amount };
}
