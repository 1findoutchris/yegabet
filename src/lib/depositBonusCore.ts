import { roundETB } from "./utils";

// Pure deposit-bonus maths, split out so it's testable without a DB and safe to
// import on the client (the deposit page shows the live offer). Same split as
// rewardConfigCore / spinCore / adsCore.

export type DepositBonusRuleId = "firstDeposit" | "reload";

export interface DepositBonusRule {
  enabled: boolean;
  /** Fraction of the deposit, 0–1. 0.2 = 20%. */
  pct: number;
  /** Hard ceiling on the bonus itself, not on the deposit. */
  maxEtb: number;
  /** Deposits below this earn nothing. */
  minDepositEtb: number;
}

/** The custom-% promo also carries an optional self-expiring window. */
export interface ReloadBonusRule extends DepositBonusRule {
  /** ISO date `YYYY-MM-DD`, or "" for no bound. */
  startsAt: string;
  endsAt: string;
}

export interface DepositBonusConfig {
  firstDeposit: DepositBonusRule;
  reload: ReloadBonusRule;
}

export interface DepositBonusQuote {
  amount: number;
  rule: DepositBonusRuleId | null;
}

export const NO_BONUS: DepositBonusQuote = { amount: 0, rule: null };

/**
 * Is the reload promo live right now? The toggle is the master switch; the
 * dates are optional bounds on top of it, so an admin can either flip it
 * manually or set a window and let it expire itself.
 *
 * `endsAt` is inclusive of the whole day, matching how ad expiry reads.
 */
export function reloadWindowOpen(rule: ReloadBonusRule, now: Date): boolean {
  if (!rule.enabled) return false;
  if (rule.startsAt && now < new Date(`${rule.startsAt}T00:00:00.000Z`)) return false;
  if (rule.endsAt && now > new Date(`${rule.endsAt}T23:59:59.999Z`)) return false;
  return true;
}

/** Payout for one rule, or 0 when it doesn't apply. Capped, never negative. */
function payout(rule: DepositBonusRule, deposit: number): number {
  if (!rule.enabled) return 0;
  if (rule.pct <= 0 || rule.maxEtb <= 0) return 0;
  if (deposit < rule.minDepositEtb) return 0;
  return roundETB(Math.min(deposit * rule.pct, rule.maxEtb));
}

/**
 * What bonus a deposit earns.
 *
 * Both rules can be enabled at once. When both apply, the player gets the
 * BETTER of the two rather than the sum — so the maximum cost of a deposit is
 * always the single most generous rule, not however many happen to be switched
 * on at the time. Ties go to the first-deposit rule, which only ever fires once
 * per player.
 */
export function quoteDepositBonus(
  deposit: number,
  isFirstDeposit: boolean,
  cfg: DepositBonusConfig,
  now: Date,
): DepositBonusQuote {
  if (!(deposit > 0)) return NO_BONUS;

  const first = isFirstDeposit ? payout(cfg.firstDeposit, deposit) : 0;
  const reload = reloadWindowOpen(cfg.reload, now) ? payout(cfg.reload, deposit) : 0;

  if (first <= 0 && reload <= 0) return NO_BONUS;
  return first >= reload
    ? { amount: first, rule: "firstDeposit" }
    : { amount: reload, rule: "reload" };
}
