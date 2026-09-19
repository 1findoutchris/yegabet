import { describe, expect, test } from "vitest";
import { normalizePhone, isEthiopianAttempt } from "@/lib/sms";

/*
 * Phone normalisation is an auth gate, not a formatting nicety.
 *
 * The registration flow decides whether to demand an SMS OTP from
 * `normalizePhone(phone) !== null`. A number that fails to normalise is treated
 * as foreign and skips verification entirely — so any Ethiopian number this
 * function rejects becomes an unverified account.
 *
 * That is a bug this codebase actually shipped: typing the trunk `0`
 * (`0912345678`) produced `+251091234567`, which failed to normalise, so
 * /api/auth/otp/send returned { skip: true } and the account was created with
 * no verification at all. `isEthiopianAttempt` exists to close it.
 */

describe("normalizePhone", () => {
  test.each([
    // local 9-digit, both operator prefixes
    ["912345678", "+251912345678"],
    ["712345678", "+251712345678"],
    // trunk-prefixed 10-digit, how Ethiopians actually write it
    ["0912345678", "+251912345678"],
    ["0712345678", "+251712345678"],
    // country code, with and without +
    ["251912345678", "+251912345678"],
    ["+251912345678", "+251912345678"],
    // punctuation and spacing are stripped
    ["+251 91 234 5678", "+251912345678"],
    ["0912-345-678", "+251912345678"],
    ["(0912) 345 678", "+251912345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  test.each([
    ["", "empty"],
    ["91234567", "8 digits — too short"],
    ["9123456789", "10 digits — too long"],
    ["0812345678", "invalid operator prefix 8"],
    ["0612345678", "invalid operator prefix 6"],
    ["+251091234567", "the trunk 0 kept after the country code"],
    ["+971501234567", "UAE"],
    ["abcdefghi", "not digits"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("isEthiopianAttempt", () => {
  // Separates "foreign number, no SMS rail" from "Ethiopian number typed
  // wrong". Only the first may legitimately skip OTP; treating the second as
  // foreign is the bypass.
  test.each([
    "+251912345678",
    "251912345678",
    "+251091234567", // malformed, but unmistakably aimed at Ethiopia
    "+251",          // just the country code
    "+251 999",
  ])("recognises %s as an Ethiopian attempt", (input) => {
    expect(isEthiopianAttempt(input)).toBe(true);
  });

  test.each([
    ["+971501234567", "UAE — starts with 9 like an Ethiopian local number"],
    ["+254712345678", "Kenya"],
    ["+1 555 0100", "US"],
    ["", "empty"],
  ])("treats %s as foreign (%s)", (input) => {
    expect(isEthiopianAttempt(input)).toBe(false);
  });

  test("a malformed Ethiopian number is never silently foreign", () => {
    // The exact regression: both false would send it down the skip-OTP path.
    const typo = "+251091234567";
    expect(normalizePhone(typo)).toBeNull();
    expect(isEthiopianAttempt(typo)).toBe(true); // → the route must 400, not skip
  });
});
