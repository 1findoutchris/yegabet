/* Admin-adjustable per-method deposit/withdrawal limits, in whole ETB.
   Kept pure (no `server-only`) so the deposit and withdraw pages phrase a
   rejection exactly the way their API route does — the routes are what
   actually enforce it, see checkPaymentAmount in paymentConfig.ts. */

export interface MethodLimits {
  minDeposit: number;
  maxDeposit: number;
  minWithdraw: number;
  maxWithdraw: number;
}

/** What both routes used to hardcode; also the column defaults, so a method
    nobody has edited behaves exactly as it did before limits were editable. */
export const DEFAULT_LIMITS: MethodLimits = {
  minDeposit: 50,
  maxDeposit: 100_000,
  minWithdraw: 50,
  maxWithdraw: 100_000,
};

export type Direction = "deposit" | "withdraw";

export function limitsFor(l: MethodLimits, direction: Direction) {
  return direction === "deposit"
    ? { min: l.minDeposit, max: l.maxDeposit }
    : { min: l.minWithdraw, max: l.maxWithdraw };
}

/** Rejection message, or null when the amount is inside the band. */
export function limitError(
  amount: number,
  direction: Direction,
  { min, max }: { min: number; max: number }
): string | null {
  const noun = direction === "deposit" ? "deposit" : "withdrawal";
  if (amount < min) return `Minimum ${noun} is ETB ${min.toLocaleString()}`;
  if (amount > max) return `Maximum ${noun} is ETB ${max.toLocaleString()}`;
  return null;
}
