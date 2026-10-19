/**
 * Account types from CLAUDE.md §5.1. Whether an account may go negative is a
 * property of its type, never a caller's choice (plan 02 §5).
 *
 * Balance convention: balance = Σ credits − Σ debits. A negative
 * AGENT_CASH_POSITION means the agent physically holds platform cash (§5.7);
 * COMPANY_FLOAT funds winnings (§6); PROVIDER_PAYABLE runs both ways.
 */
export const ACCOUNT_TYPES = {
  PLAYER_WALLET: { allowNegative: false },
  PLAYER_HELD: { allowNegative: false },
  AGENT_CASH_POSITION: { allowNegative: true },
  AGENT_PAYABLE: { allowNegative: false },
  PARENT_PAYABLE: { allowNegative: false },
  COMPANY_FLOAT: { allowNegative: true },
  COMPANY_REVENUE: { allowNegative: false },
  PROVIDER_PAYABLE: { allowNegative: true },
  PROVIDER_FEES: { allowNegative: false },
} as const;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export const OWNER_KINDS = ["player", "agent", "company", "provider"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const CURRENCY = "ETB";

export function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ACCOUNT_TYPES, v);
}

export function isOwnerKind(v: unknown): v is OwnerKind {
  return typeof v === "string" && (OWNER_KINDS as readonly string[]).includes(v);
}
