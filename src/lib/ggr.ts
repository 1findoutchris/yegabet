/**
 * Gross gaming revenue over the Silent API rails and the provider's cut.
 *
 * BET/WIN transactions are written in exactly one place — the Silent API wallet
 * callback (src/app/api/provider/wallet/callback/route.ts). That row's `amount`
 * is only |win − bet| for the round, so the gross figures come from the stored
 * callback payload instead: `metadata.bet_amount` is what the player staked and
 * `metadata.win_amount` is what the round paid back.
 *
 * A round is several callbacks, not one: the stake arrives as its own event
 * (bet_amount set, win_amount 0), any win as a second, and most games send a
 * third with both at 0 to close the round. They share `metadata.game_round`, so
 * the route nets each round back together before any of this is computed — read
 * one row's bet in isolation and every stake looks like a house win.
 *
 * Billing is per round and never netted. Verified against Silent API's own
 * Game_Transactions export, 39,323 rounds, zero mismatches:
 *
 *   GGR Deducted = 10% × max(bet − win, 0), per round
 *
 * A round the player won is charged 0 — not a credit — so it cannot offset a
 * round the house won. The sheet's worked example nets a whole month, but that
 * is not what they invoice: over 22–24 Aug our GGR was −3,784.37 and they still
 * deducted 15,197.36. Bill what they charge, not what the sheet describes.
 *
 * Everything here is ETB, so the same-currency rule needs no handling.
 */

/** The provider's revenue share: 10% of each round the house wins. */
export const SILENT_GGR_RATE = 0.1;

/** One period's raw sums, as aggregated by Postgres. */
export interface GgrBucket {
  /** Total staked by players — what they played with, ETB. */
  staked: number;
  /** Total paid back to players as wins, ETB. */
  payout: number;
  /** Σ max(bet − win, 0) over rounds — the base Silent API bills on, ETB. */
  billable: number;
  /** Distinct game rounds, not callbacks — a round emits two or three. */
  rounds: number;
}

export interface GgrTotals extends GgrBucket {
  /** Stakes minus payouts, ETB — what players lost. Negative when they ran hot. */
  ggr: number;
  /** Silent API's share — 10% of `billable`. Never negative, never refunded. */
  silentCut: number;
}

/** Roll one period's sums into the billed figures. */
export function ggrSplit(b: GgrBucket): GgrTotals {
  return {
    staked: round2(b.staked),
    payout: round2(b.payout),
    billable: round2(b.billable),
    rounds: b.rounds,
    ggr: round2(b.staked - b.payout),
    silentCut: round2(b.billable * SILENT_GGR_RATE),
  };
}

export function sumBuckets(buckets: GgrBucket[]): GgrBucket {
  return buckets.reduce(
    (acc, b) => ({
      staked: acc.staked + b.staked,
      payout: acc.payout + b.payout,
      billable: acc.billable + b.billable,
      rounds: acc.rounds + b.rounds,
    }),
    { staked: 0, payout: 0, billable: 0, rounds: 0 },
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
