/*
 * Pure routing + SLA rules for payout agents.
 *
 * Free of `server-only` and prisma so payoutRouting.check.ts can exercise it —
 * this decides who gets paid work and who gets blamed for a late payout.
 */

export interface AgentLoad {
  id: string;
  /** Requests currently PENDING or PROCESSING for this agent. */
  open: number;
}

/**
 * Least-loaded routing: the eligible agent holding the fewest open requests.
 *
 * Ties break on `id` so the choice is deterministic — with equal load this
 * degenerates to a stable rotation rather than always hammering whoever the
 * database happened to return first.
 */
export function pickLeastLoaded(agents: AgentLoad[]): string | null {
  if (agents.length === 0) return null;
  return agents.reduce((best, a) =>
    a.open < best.open || (a.open === best.open && a.id < best.id) ? a : best,
  ).id;
}

/** Minutes elapsed between two instants, floored at 0. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 60_000);
}

export interface SlaState {
  /** Whole minutes on the clock so far. */
  elapsedMinutes: number;
  /** Past the agent's allowance. */
  breached: boolean;
  /** Minutes left before breach; 0 once breached. */
  remainingMinutes: number;
}

/**
 * SLA position of a request. The clock runs from assignment to payout — or to
 * now while it's still open. Breaching only flags and counts; it never moves
 * money or reassigns on its own.
 */
export function slaState(
  assignedAt: Date | null,
  paidAt: Date | null,
  slaMinutes: number,
  now: Date = new Date(),
): SlaState | null {
  // Nothing was ever routed, so nobody is on the hook for it.
  if (!assignedAt) return null;

  const elapsed = minutesBetween(assignedAt, paidAt ?? now);
  const elapsedMinutes = Math.floor(elapsed);
  // Compare on the unfloored value so 30.4 minutes against a 30-minute SLA is a
  // breach rather than being rounded back onto the line.
  const breached = elapsed > slaMinutes;
  return {
    elapsedMinutes,
    breached,
    remainingMinutes: breached ? 0 : Math.max(0, Math.ceil(slaMinutes - elapsed)),
  };
}

/**
 * Rails an agent can be paid on, and the rails they can be assigned to process.
 * One list so the admin's agent form and the agent's own payout request can't
 * offer different sets. Values match WithdrawalRequest.method.
 */
export const PAYOUT_METHODS = ["telebirr", "cbebirr", "ebirr", "cbe", "boa"] as const;
