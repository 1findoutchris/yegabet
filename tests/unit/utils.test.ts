import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { roundETB, formatCurrency, verifyHmacSignature } from "@/lib/utils";

const SECRET = "test-secret-key";
const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

/*
 * verifyHmacSignature is the ONLY thing authenticating /api/provider/wallet/callback,
 * which settles bets and credits wins. There is no session on that route — a
 * forged signature getting through means free money.
 *
 * It parses a hex string by hand (`match(/.{2}/g)` + parseInt), which is where
 * malformed input can go wrong: parseInt on non-hex yields NaN, and NaN in a
 * Uint8Array becomes 0. So garbage must be REJECTED, not coerced into a
 * comparison that might accidentally pass.
 */
describe("verifyHmacSignature", () => {
  const body = JSON.stringify({ action: "bet", amount: 100, serial_number: "abc" });

  test("accepts a correct signature", async () => {
    expect(await verifyHmacSignature(body, sign(body), SECRET)).toBe(true);
  });

  test("rejects a signature made with a different secret", async () => {
    expect(await verifyHmacSignature(body, sign(body, "wrong-secret"), SECRET)).toBe(false);
  });

  test("rejects when the body was tampered with after signing", async () => {
    const sig = sign(body);
    const tampered = JSON.stringify({ action: "bet", amount: 999999, serial_number: "abc" });
    expect(await verifyHmacSignature(tampered, sig, SECRET)).toBe(false);
  });

  test("is case-insensitive about hex, since parseInt is", async () => {
    expect(await verifyHmacSignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });

  test.each([
    ["", "empty signature"],
    ["zz".repeat(32), "non-hex characters → NaN → zero bytes"],
    ["abc", "odd length, truncated by the 2-char split"],
    ["ab", "far too short"],
    ["ff".repeat(64), "right shape, wrong bytes"],
    ["not a signature at all", "free text"],
  ])("rejects %s (%s)", async (badSig) => {
    expect(await verifyHmacSignature(body, badSig, SECRET)).toBe(false);
  });

  test.each(["", "zz".repeat(32), "abc", "not a signature at all"])(
    "never throws on malformed input: %s",
    async (badSig) => {
      // A throw here would 500 the callback instead of cleanly rejecting it,
      // and the provider would retry a request that can never succeed.
      await expect(verifyHmacSignature(body, badSig, SECRET)).resolves.toBeTypeOf("boolean");
    },
  );

  test("an empty body still verifies against its own signature", async () => {
    expect(await verifyHmacSignature("", sign(""), SECRET)).toBe(true);
  });
});

describe("roundETB", () => {
  test.each([
    [10.005, 10.01],
    [10.004, 10],
    [0.1 + 0.2, 0.3],   // the float-drift case this exists for
    [100, 100],
    [0, 0],
    [1234.5678, 1234.57],
  ])("rounds %s to %s", (input, expected) => {
    expect(roundETB(input)).toBe(expected);
  });

  test("halves round toward +Infinity, so negatives are asymmetric", () => {
    // Math.round(-555.5) is -555, not -556. Pinned because it means a negative
    // amount (an admin deduction) rounds a cent in the platform's favour while
    // the positive case rounds in the player's. Sub-cent, but it is a real
    // asymmetry and should be a deliberate change if anyone "fixes" it.
    expect(roundETB(-5.555)).toBe(-5.55);
    expect(roundETB(5.555)).toBe(5.56);
  });

  test("is idempotent — rounding twice changes nothing", () => {
    const once = roundETB(33.333333);
    expect(roundETB(once)).toBe(once);
  });
});

describe("formatCurrency", () => {
  test("always labels ETB and always shows 2dp", () => {
    // Single-currency platform: no per-user currency, no conversion.
    expect(formatCurrency(1000)).toBe("ETB 1,000.00");
    expect(formatCurrency(0)).toBe("ETB 0.00");
    expect(formatCurrency(1234.5)).toBe("ETB 1,234.50");
  });
});
