/*
 * Self-check for Telegram phone verification — the branch that decides whether
 * a shared contact proves ownership of the number typed into the signup form.
 * Run: `npx tsx src/lib/tgVerify.check.ts`
 */
import assert from "node:assert";
import { contactVerdict, startPayload, verifyDeepLink } from "./tgVerifyCore";

const ME = 12345;
const PHONE = "+251912345678";

// ── the security case ────────────────────────────────────────────────────────
// A contact card whose user_id is the sender is the only thing Telegram
// vouches for. Everything else is an address-book entry anyone can forward.
assert.strictEqual(contactVerdict({ phone_number: PHONE, user_id: ME }, ME, PHONE).ok, true);

assert.strictEqual(
  contactVerdict({ phone_number: PHONE, user_id: 999 }, ME, PHONE).ok,
  false,
  "forwarded someone else's card — must never verify",
);
assert.strictEqual(
  contactVerdict({ phone_number: PHONE }, ME, PHONE).ok,
  false,
  "no user_id: a manually-typed address-book entry, not a Telegram account",
);
assert.strictEqual(
  contactVerdict({ phone_number: PHONE, user_id: String(ME) }, ME, PHONE).ok,
  false,
  "user_id must be a number, not a string that merely looks like one",
);

// ── the number has to be the one they signed up with ─────────────────────────
assert.strictEqual(
  contactVerdict({ phone_number: "+251987654321", user_id: ME }, ME, PHONE).ok,
  false,
  "right person, wrong number",
);
// Telegram sends the number without a +, and people type the trunk 0 — same
// number, so both must pass.
assert.strictEqual(contactVerdict({ phone_number: "251912345678", user_id: ME }, ME, PHONE).ok, true);
assert.strictEqual(contactVerdict({ phone_number: PHONE, user_id: ME }, ME, "+251912345678").ok, true);
assert.strictEqual(
  contactVerdict({ phone_number: "+15551234567", user_id: ME }, ME, PHONE).ok,
  false,
  "foreign number can't normalize, so it can't match",
);
assert.strictEqual(contactVerdict({ user_id: ME }, ME, PHONE).ok, false, "no number at all");

// ── /start payloads ──────────────────────────────────────────────────────────
assert.strictEqual(startPayload("/start abc123"), "abc123");
assert.strictEqual(startPayload("  /start abc123  "), "abc123");
assert.strictEqual(startPayload("/start@VinnaVerifyBot abc123"), "abc123", "groups get the @bot suffix");
assert.strictEqual(startPayload("/start"), null, "bare /start carries no verification");
assert.strictEqual(startPayload("/balance"), null);
assert.strictEqual(startPayload("hello"), null);
assert.strictEqual(startPayload("/start a b"), null, "a token never contains a space");
assert.strictEqual(startPayload("/start ../../etc"), null, "outside Telegram's payload alphabet");
assert.strictEqual(startPayload("/start " + "a".repeat(65)), null, "longer than a payload can be");

// ── deep link ────────────────────────────────────────────────────────────────
const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
assert.strictEqual(
  verifyDeepLink("tok", env({ TELEGRAM_VERIFY_BOT_USERNAME: "VinnaVerifyBot" })),
  "https://t.me/VinnaVerifyBot?start=tok",
);
assert.strictEqual(
  verifyDeepLink("tok", env({ TELEGRAM_VERIFY_BOT_USERNAME: "@VinnaVerifyBot" })),
  "https://t.me/VinnaVerifyBot?start=tok",
  "a pasted @username must not become a broken link",
);
assert.strictEqual(verifyDeepLink("tok", env({})), "", "unconfigured → no link, caller falls back");

console.log("telegram verify self-check passed");
