import { ACCOUNT_TYPES, isAccountType, isOwnerKind } from "../../src/ledger/accountTypes";
import { ValidationError } from "../../src/ledger/errors";
import {
  MAX_AMOUNT,
  MAX_LEGS,
  requestHash,
  validatePosting,
  type PostingRequest,
} from "../../src/ledger/request";

const leg = { debitAccountId: 1n, creditAccountId: 2n, amount: 100n };
const ok: PostingRequest = { idempotencyKey: "k1", reason: "test", entries: [leg] };

function rejects(req: unknown, message: RegExp): void {
  expect(() => validatePosting(req as PostingRequest)).toThrow(ValidationError);
  expect(() => validatePosting(req as PostingRequest)).toThrow(message);
}

describe("validatePosting", () => {
  it("accepts a valid posting and drops an absent referenceId", () => {
    expect(validatePosting(ok)).toEqual(ok);
    expect(validatePosting({ ...ok, referenceId: "dep-1" }).referenceId).toBe("dep-1");
  });

  it("rejects missing or blank text fields", () => {
    rejects(undefined, /idempotencyKey is required/);
    rejects({ ...ok, idempotencyKey: "" }, /idempotencyKey must be a non-empty string/);
    rejects({ ...ok, idempotencyKey: "   " }, /idempotencyKey must be a non-empty string/);
    rejects({ ...ok, reason: undefined }, /reason is required/);
    rejects({ ...ok, reason: 42 }, /reason must be a non-empty string/);
    rejects({ ...ok, referenceId: "" }, /referenceId must be a non-empty string/);
    rejects({ ...ok, reason: "x".repeat(201) }, /longer than 200/);
  });

  it("accepts a null referenceId as absent", () => {
    expect(
      validatePosting({ ...ok, referenceId: null } as unknown as PostingRequest).referenceId,
    ).toBeUndefined();
  });

  it("rejects empty, missing and oversized entry lists", () => {
    rejects({ ...ok, entries: [] }, /non-empty array/);
    rejects({ ...ok, entries: undefined }, /non-empty array/);
    rejects({ ...ok, entries: Array.from({ length: MAX_LEGS + 1 }, () => leg) }, /at most 100/);
  });

  it("rejects bad account ids", () => {
    rejects({ ...ok, entries: [null] }, /debitAccountId must be a positive bigint/);
    rejects({ ...ok, entries: [{ ...leg, debitAccountId: 1 }] }, /debitAccountId must be a positive bigint/);
    rejects(
      { ...ok, entries: [{ ...leg, creditAccountId: 0n }] },
      /creditAccountId must be a positive bigint/,
    );
    rejects({ ...ok, entries: [{ ...leg, creditAccountId: 1n }] }, /same account/);
  });

  it("rejects floats, zero, negative and oversized amounts", () => {
    rejects({ ...ok, entries: [{ ...leg, amount: 1.5 }] }, /must be a bigint/);
    rejects({ ...ok, entries: [{ ...leg, amount: 100 }] }, /must be a bigint/);
    rejects({ ...ok, entries: [{ ...leg, amount: 0n }] }, /must be positive/);
    rejects({ ...ok, entries: [{ ...leg, amount: -5n }] }, /must be positive/);
    rejects({ ...ok, entries: [{ ...leg, amount: MAX_AMOUNT + 1n }] }, /exceeds/);
    expect(validatePosting({ ...ok, entries: [{ ...leg, amount: MAX_AMOUNT }] }).entries[0]?.amount).toBe(
      MAX_AMOUNT,
    );
  });
});

describe("requestHash", () => {
  it("is independent of key order and stable for bigints", () => {
    const a = requestHash("post", { reason: "r", idempotencyKey: "k", entries: [leg] });
    const b = requestHash("post", {
      idempotencyKey: "k",
      entries: [{ amount: 100n, creditAccountId: 2n, debitAccountId: 1n }],
      reason: "r",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the amount, the accounts, the kind and the reason", () => {
    const base = requestHash("post", { idempotencyKey: "k", reason: "r", entries: [leg] });
    expect(
      requestHash("post", { idempotencyKey: "k", reason: "r", entries: [{ ...leg, amount: 101n }] }),
    ).not.toBe(base);
    expect(
      requestHash("post", { idempotencyKey: "k", reason: "r", entries: [{ ...leg, creditAccountId: 3n }] }),
    ).not.toBe(base);
    expect(requestHash("reverse", { idempotencyKey: "k", reason: "r", entries: [leg] })).not.toBe(base);
    expect(requestHash("post", { idempotencyKey: "k", reason: "other", entries: [leg] })).not.toBe(base);
  });
});

describe("account types", () => {
  it("lets only cash position, float and provider payable go negative", () => {
    const negative = Object.entries(ACCOUNT_TYPES)
      .filter(([, t]) => t.allowNegative)
      .map(([k]) => k)
      .sort();
    expect(negative).toEqual(["AGENT_CASH_POSITION", "COMPANY_FLOAT", "PROVIDER_PAYABLE"]);
    expect(Object.keys(ACCOUNT_TYPES)).toHaveLength(9);
  });

  it("recognizes types and owner kinds", () => {
    expect(isAccountType("PLAYER_WALLET")).toBe(true);
    expect(isAccountType("toString")).toBe(false);
    expect(isAccountType(7)).toBe(false);
    expect(isOwnerKind("agent")).toBe(true);
    expect(isOwnerKind("staff")).toBe(false);
    expect(isOwnerKind(undefined)).toBe(false);
  });
});
