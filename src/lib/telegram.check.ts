/*
 * Self-check for the payout-agent Telegram login flow.
 * Run: `npx tsx src/lib/telegram.check.ts`
 *
 * The one rule that matters: a password must never be interpreted as anything
 * but a password, and a command must never be swallowed as one.
 */
import assert from "node:assert";
import { botStep, AWAITING_USERNAME } from "./telegram";

// ── commands ────────────────────────────────────────────────────────────────
assert.deepStrictEqual(botStep(null, "/start"), { do: "ask-username" });
assert.deepStrictEqual(botStep(null, "/login"), { do: "ask-username" });
assert.deepStrictEqual(botStep(null, "/balance"), { do: "balance" });
assert.deepStrictEqual(botStep(null, "/logout"), { do: "logout" });
assert.deepStrictEqual(botStep(null, "/cancel"), { do: "logout" });
assert.deepStrictEqual(botStep(null, "/nonsense"), { do: "help" });
assert.deepStrictEqual(botStep(null, "hello"), { do: "help" }, "chatter before /login is not a credential");

// Telegram appends the bot name to commands in groups.
assert.deepStrictEqual(botStep(null, "/balance@FetanPayoutBot"), { do: "balance" });
assert.deepStrictEqual(botStep(null, "  /BALANCE  "), { do: "balance" }, "case and padding must not matter");

// ── the two-step login ──────────────────────────────────────────────────────
assert.deepStrictEqual(
  botStep(AWAITING_USERNAME, " pay_a3k9zq "),
  { do: "ask-password", username: "pay_a3k9zq" },
  "the username is trimmed — a stray space would fail the lookup",
);
assert.deepStrictEqual(
  botStep(AWAITING_USERNAME, "   "),
  { do: "ask-username" },
  "an empty username re-asks rather than looking up ''",
);
assert.deepStrictEqual(
  botStep("pay_a3k9zq", "K7M2 PWD"),
  { do: "login", username: "pay_a3k9zq", password: "K7M2 PWD" },
  "the password is passed through verbatim — trimming it would break real passwords",
);

// A command mid-login escapes the state machine instead of being logged as a
// password attempt.
assert.deepStrictEqual(botStep("pay_a3k9zq", "/balance"), { do: "balance" });
assert.deepStrictEqual(botStep(AWAITING_USERNAME, "/logout"), { do: "logout" });

// Once linked (nothing pending), stray text is never treated as a credential.
assert.deepStrictEqual(botStep(null, "K7M2XPWD"), { do: "help" });

console.log("telegram.check.ts ✓");
