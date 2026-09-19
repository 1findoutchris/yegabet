import { redis } from "./redis";

/* Realtime per-user balance updates.
   Both the deposit approval flow and the game-provider wallet callback publish
   here; the /api/user/balance/stream SSE endpoint fans them out to the
   player's open tabs so the wallet (and a deposit-approved toast) update live. */

export interface BalanceEvent {
  /** Total playable funds. */
  balance: number;
  /** The withdrawable slice of it (balance − deposit − bonus), when known. */
  withdrawable?: number;
  /** What caused the change — drives the client toast/animation.
   *  "bonus" means bonus credit was granted: it raises `balance` but lands in
   *  the non-withdrawable pot, so the client should re-read the full snapshot. */
  reason: "deposit" | "bet" | "win" | "withdrawal" | "adjust" | "bonus";
  /** The transaction amount (always positive). */
  amount?: number;
}

export function userBalanceChannel(userId: string): string {
  return `user:${userId}:balance`;
}

export async function publishBalanceEvent(
  userId: string,
  event: BalanceEvent
): Promise<void> {
  await redis
    .publish(userBalanceChannel(userId), JSON.stringify(event))
    .catch(() => {});
}
