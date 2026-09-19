import "server-only";
import { roundETB } from "./utils";

/*
 * One agent, two money positions.
 *
 * `outstanding` — the payout rail. The agent pays players from their own funds
 * and the platform owes them back: PAYOUT + COMMISSION − SETTLEMENT.
 *
 * `float` — the cash rail. The agent buys credit up front and spends it down
 * crediting walk-in customers: TOPUP + CASH_PAYOUT − CASH_DEPOSIT − FLOAT_RETURN.
 *
 * They are deliberately disjoint sets of row types, so an agent doing both jobs
 * has two independent balances rather than one that nets them against each
 * other. COMMISSION belongs to `outstanding` only — cash-rail commission gets
 * its own row type when the monthly accrual lands, precisely so that adding it
 * cannot silently move what the payout rail already computes.
 *
 * Neither is a stored column. Both are sums of the ledger, which is what makes
 * every balance explainable by the rows that produced it.
 */

export const OUTSTANDING_TYPES = ["PAYOUT", "COMMISSION", "SETTLEMENT"] as const;
export const FLOAT_TYPES = [
  "TOPUP", "CASH_PAYOUT", "CASH_DEPOSIT", "FLOAT_RETURN", "COMMISSION_PAYOUT",
  "CASH_REVERSAL",
] as const;
/** Cash-rail commission accrues here and only becomes spendable on the 1st. */
export const PENDING_COMMISSION_TYPES = [
  "CASH_COMMISSION", "COMMISSION_PAYOUT", "CASH_COMMISSION_REVERSAL",
] as const;

/*
 * Reversals are their own row types rather than negative amounts on the
 * originals. Every amount in this table stays positive, so "what did this agent
 * do" reads off the type column instead of the sign — and a cancelled deposit
 * stays visible as two rows that explain each other, rather than vanishing.
 */
const FLOAT_CREDIT = new Set<string>(["TOPUP", "CASH_PAYOUT", "COMMISSION_PAYOUT", "CASH_REVERSAL"]);
const FLOAT_DEBIT = new Set<string>(["CASH_DEPOSIT", "FLOAT_RETURN"]);

/** A `groupBy(["type"], _sum: {amount})` result, or the agentId-wide variant. */
export interface LedgerSum {
  type: string;
  _sum: { amount: unknown };
}

export interface AgentPosition {
  paidOut: number;
  commission: number;
  settled: number;
  /** What the platform still owes this agent on the payout rail. */
  outstanding: number;
  toppedUp: number;
  cashIn: number;
  cashOut: number;
  /** Cash-rail commission earned but not yet released into float. */
  pendingCommission: number;
  /** Spendable credit left on the cash rail. Never negative in practice —
   *  every spend is guarded — but reported as-is so a bug shows rather than
   *  being clamped out of sight. */
  float: number;
}

export function agentPosition(rows: LedgerSum[]): AgentPosition {
  const sum = (type: string) => Number(rows.find((r) => r.type === type)?._sum.amount ?? 0);

  const paidOut = sum("PAYOUT");
  const commission = sum("COMMISSION");
  const settled = sum("SETTLEMENT");

  const toppedUp = sum("TOPUP");
  const cashOut = sum("CASH_PAYOUT");
  const cashIn = sum("CASH_DEPOSIT");
  const returned = sum("FLOAT_RETURN");
  const reversed = sum("CASH_REVERSAL");
  const accrued = sum("CASH_COMMISSION");
  const released = sum("COMMISSION_PAYOUT");
  const clawedBack = sum("CASH_COMMISSION_REVERSAL");

  return {
    paidOut,
    commission,
    settled,
    outstanding: roundETB(paidOut + commission - settled),
    toppedUp,
    cashIn,
    cashOut,
    pendingCommission: roundETB(accrued - released - clawedBack),
    float: roundETB(toppedUp + cashOut + released + reversed - cashIn - returned),
  };
}

/** Signed effect of one ledger row on float — 0 for payout-rail types. */
export function floatDelta(type: string, amount: number): number {
  if (FLOAT_CREDIT.has(type)) return amount;
  if (FLOAT_DEBIT.has(type)) return -amount;
  return 0;
}
