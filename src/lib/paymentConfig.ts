import "server-only";
import { prisma } from "./prisma";
import {
  PAYMENT_METHODS,
  type MethodId,
  type PaymentMethod,
} from "@/components/account/paymentMethods";
import {
  DEFAULT_LIMITS,
  limitError,
  limitsFor,
  type Direction,
  type MethodLimits,
} from "./paymentLimits";

/* Admin-editable settings for each payment method.
   The destination account a player transfers to (number + holder name) can
   change, and a rail can go down in either direction, so we store overrides in
   the `payment_agents` table and merge them over the static defaults in
   paymentMethods.ts. A method with no row is enabled with default details. */

export interface AgentOverride {
  agentNumber: string;
  agentName: string;
}

export interface MethodToggles {
  depositEnabled: boolean;
  withdrawEnabled: boolean;
}

/** A merged method plus its availability flags and amount limits. */
export type MergedMethod = PaymentMethod & MethodToggles & MethodLimits;

type StoredRow = AgentOverride & MethodToggles & MethodLimits;
export type AgentOverrides = Partial<Record<MethodId, StoredRow>>;

export async function getAgentOverrides(): Promise<AgentOverrides> {
  try {
    const rows = await prisma.paymentAgent.findMany();
    const out: AgentOverrides = {};
    for (const r of rows) {
      out[r.id as MethodId] = {
        agentNumber: r.agentNumber,
        agentName: r.agentName,
        depositEnabled: r.depositEnabled,
        withdrawEnabled: r.withdrawEnabled,
        minDeposit: r.minDeposit,
        maxDeposit: r.maxDeposit,
        minWithdraw: r.minWithdraw,
        maxWithdraw: r.maxWithdraw,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export async function setAgentOverride(
  id: MethodId,
  data: AgentOverride & MethodLimits
): Promise<void> {
  await prisma.paymentAgent.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}

/**
 * Flip a method's availability. Creating the row when it's missing needs the
 * static defaults for the agent columns, since those are NOT NULL — an admin
 * can disable a method they've never edited the account details for.
 */
export async function setMethodToggles(
  id: MethodId,
  toggles: Partial<MethodToggles>
): Promise<void> {
  const fallback = PAYMENT_METHODS.find((m) => m.id === id);
  await prisma.paymentAgent.upsert({
    where: { id },
    create: {
      id,
      agentNumber: fallback?.agentNumber ?? "",
      agentName: fallback?.agentName ?? "",
      ...toggles,
    },
    update: toggles,
  });
}

/** Static defaults with any saved overrides and toggles applied. */
export async function getMergedMethods(): Promise<MergedMethod[]> {
  const overrides = await getAgentOverrides();
  return PAYMENT_METHODS.map((m) => {
    const o = overrides[m.id];
    return {
      ...m,
      agentNumber: o?.agentNumber?.trim() || m.agentNumber,
      agentName: o?.agentName?.trim() || m.agentName,
      // No row → enabled, default limits. Keeps every existing install working
      // untouched.
      depositEnabled: o?.depositEnabled ?? true,
      withdrawEnabled: o?.withdrawEnabled ?? true,
      minDeposit: o?.minDeposit ?? DEFAULT_LIMITS.minDeposit,
      maxDeposit: o?.maxDeposit ?? DEFAULT_LIMITS.maxDeposit,
      minWithdraw: o?.minWithdraw ?? DEFAULT_LIMITS.minWithdraw,
      maxWithdraw: o?.maxWithdraw ?? DEFAULT_LIMITS.maxWithdraw,
    };
  });
}

/**
 * Server-side gate for the deposit/withdraw routes: is this rail open, and is
 * the amount inside the admin's limits? Returns the rejection message, or null
 * to proceed. Hiding a tile or greying an input is presentation; this is what
 * actually stops a stale tab or a direct POST.
 *
 * One call rather than a separate enabled check so both routes read the same
 * config once — the limits and the kill switch live in the same row.
 *
 * Fails OPEN on a DB error, matching getAgentOverrides — a config lookup
 * failing must not take payments down entirely (getMergedMethods returns the
 * static defaults, so the old hardcoded limits still apply).
 */
export async function checkPaymentAmount(
  id: string,
  direction: Direction,
  amount: number
): Promise<string | null> {
  const methods = await getMergedMethods();
  const m = methods.find((x) => x.id === id);
  const open = direction === "deposit" ? m?.depositEnabled : m?.withdrawEnabled;
  if (!m || !open) {
    return direction === "deposit"
      ? "This payment method is unavailable right now. Please choose another."
      : "This payout method is unavailable right now. Please choose another.";
  }
  return limitError(amount, direction, limitsFor(m, direction));
}
