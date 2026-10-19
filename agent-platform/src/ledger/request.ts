import { createHash } from "node:crypto";
import { ValidationError } from "./errors";

/** One movement: `amount` santim leaves the debit account and lands in the credit account. */
export interface Leg {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
}

export interface PostingRequest {
  idempotencyKey: string;
  reason: string;
  referenceId?: string;
  entries: Leg[];
}

/** 10^15 santim = 10 trillion ETB: far above any real movement, far below BIGINT overflow. */
export const MAX_AMOUNT = 10n ** 15n;
export const MAX_LEGS = 100;
const MAX_TEXT = 200;

function text(name: string, v: unknown, required: boolean): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.trim() === "")
    throw new ValidationError(`${name} must be a non-empty string`);
  if (v.length > MAX_TEXT) throw new ValidationError(`${name} is longer than ${MAX_TEXT} characters`);
  return v;
}

function id(name: string, v: unknown): bigint {
  if (typeof v !== "bigint" || v <= 0n) throw new ValidationError(`${name} must be a positive bigint`);
  return v;
}

/** Validate before touching the database. Money is bigint santim only: a `number` is refused. */
export function validatePosting(raw: PostingRequest): PostingRequest {
  const idempotencyKey = text("idempotencyKey", raw?.idempotencyKey, true) as string;
  const reason = text("reason", raw.reason, true) as string;
  const referenceId = text("referenceId", raw.referenceId, false);
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    throw new ValidationError("entries must be a non-empty array");
  }
  if (raw.entries.length > MAX_LEGS) throw new ValidationError(`at most ${MAX_LEGS} entries per posting`);

  const entries = raw.entries.map((leg, i) => {
    const debitAccountId = id(`entries[${i}].debitAccountId`, leg?.debitAccountId);
    const creditAccountId = id(`entries[${i}].creditAccountId`, leg.creditAccountId);
    if (debitAccountId === creditAccountId) {
      throw new ValidationError(`entries[${i}] debits and credits the same account`);
    }
    const amount = leg.amount;
    if (typeof amount !== "bigint")
      throw new ValidationError(`entries[${i}].amount must be a bigint (santim)`);
    if (amount <= 0n) throw new ValidationError(`entries[${i}].amount must be positive`);
    if (amount > MAX_AMOUNT) throw new ValidationError(`entries[${i}].amount exceeds ${MAX_AMOUNT}`);
    return { debitAccountId, creditAccountId, amount };
  });

  return referenceId === undefined
    ? { idempotencyKey, reason, entries }
    : { idempotencyKey, reason, referenceId, entries };
}

/**
 * Stable fingerprint of what a key was used for, so a retry with the same key
 * but a different body is caught (IdempotencyConflictError) instead of
 * silently replaying the first answer.
 */
export function requestHash(kind: "post" | "reverse", body: Record<string, unknown>): string {
  const canonical = JSON.stringify({ kind, body }, (_k, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
  return createHash("sha256").update(canonical).digest("hex");
}
