/*
 * Self-check for the OTP verdict table — the branch guarding both registration
 * and password reset.
 * Run: `npx tsx src/lib/otp.check.ts`
 */
import assert from "node:assert";
import { otpVerdict, MAX_ATTEMPTS, signupOtpDisabled, otpChannel } from "./otpCore";

// ── the signup kill switch ───────────────────────────────────────────────────
// Unset, empty, or anything that isn't exactly "true" must keep OTP on:
// registration is the only thing standing between a wrong value and unverified
// accounts.
const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
assert.strictEqual(signupOtpDisabled(env({})), false, "unset → OTP still required");
assert.strictEqual(signupOtpDisabled(env({ OTP_DISABLED: "" })), false, "empty → still required");
assert.strictEqual(signupOtpDisabled(env({ OTP_DISABLED: "false" })), false);
assert.strictEqual(signupOtpDisabled(env({ OTP_DISABLED: "1" })), false, "only the exact word disables it");
assert.strictEqual(signupOtpDisabled(env({ OTP_DISABLED: "true" })), true);

// ── which rail delivers the code ─────────────────────────────────────────────
// Anything but the exact word falls back to SMS: a half-configured bot must
// degrade to a channel that works, never to one that silently can't deliver.
assert.strictEqual(otpChannel(env({})), "sms", "unset → SMS");
assert.strictEqual(otpChannel(env({ AUTH_OTP_CHANNEL: "" })), "sms");
assert.strictEqual(otpChannel(env({ AUTH_OTP_CHANNEL: "Telegram" })), "sms", "exact string only");
assert.strictEqual(otpChannel(env({ AUTH_OTP_CHANNEL: "telegram" })), "telegram");


// Right code → in.
assert.deepStrictEqual(otpVerdict("123456", "123456", 0), { ok: true });

// No stored code (never sent, or expired) → never passes, even if the
// submitted value is empty/undefined on both sides.
assert.strictEqual(otpVerdict(null, "123456", 0).ok, false);
assert.strictEqual(otpVerdict(null, undefined, 0).ok, false);

// A missing submission must not satisfy a live code.
assert.strictEqual(otpVerdict("123456", undefined, 1).ok, false);
assert.strictEqual(otpVerdict("123456", "", 1).ok, false);

// Wrong code below the cap → plain rejection, code survives for another try.
const miss = otpVerdict("123456", "000000", 1);
assert.strictEqual(miss.ok, false);
assert.strictEqual(miss.ok === false && miss.status, 400);

// Hitting the cap → 429, which tells the caller to destroy the code.
const capped = otpVerdict("123456", "000000", MAX_ATTEMPTS);
assert.strictEqual(capped.ok, false);
assert.strictEqual(capped.ok === false && capped.status, 429);

// Brute force can never outlast the cap: every attempt past it stays 429.
assert.strictEqual(
  (otpVerdict("123456", "000000", MAX_ATTEMPTS + 7) as { status: number }).status,
  429,
);

console.log("otp self-check passed");
