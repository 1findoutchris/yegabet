// Telegram-verified registration — the pure decisions, split out of
// tgSignup.ts so they're testable without redis or a database.

import { provenPhone } from "./tgLinkCore";
import type { TgContact } from "./tgVerifyCore";

/**
 * Is registration gated on Telegram?
 *
 * On whenever the player bot is configured (token AND username — a token
 * without a username builds a dead link). While on, /api/auth/register never
 * creates an account: it only stores a pending request, and the account is
 * created by the bot webhook once the contact matches.
 *
 * TELEGRAM_SIGNUP_DISABLED=true is the rollback: registration goes back to the
 * SMS / AUTH_OTP_CHANNEL rail exactly as before. Opt-out by exact string, so a
 * typo leaves the stricter flow on.
 */
export function telegramSignupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    !!env.TELEGRAM_VERIFY_BOT_TOKEN &&
    !!env.TELEGRAM_VERIFY_BOT_USERNAME &&
    env.TELEGRAM_SIGNUP_DISABLED !== "true"
  );
}

export type SignupFailure =
  | "not-own-contact" // forwarded / address-book / someone else's card
  | "not-ethiopian" // the Telegram number isn't an Ethiopian mobile
  | "mismatch" // the sender's own number, but not the one on the form
  | "telegram-in-use" // this Telegram already has a VinnaBet account
  | "phone-taken"; // the number got registered meanwhile

export type SignupVerdict =
  | { ok: true; phone: string }
  | { ok: false; reason: SignupFailure; shared?: string };

/**
 * Does this contact prove the sender owns the number typed on the form?
 *
 *   1. It must be the sender's OWN card (contact.user_id === from.id) — the
 *      only kind Telegram vouches for. A typed number never reaches here
 *      (it's a text message, not a contact).
 *   2. Its number, normalized to E.164, must equal the form's number.
 */
export function signupContactVerdict(contact: TgContact, fromId: number, expected: string): SignupVerdict {
  const proof = provenPhone(contact, fromId);
  if (!proof.ok) return { ok: false, reason: proof.reason };
  if (proof.phone !== expected) return { ok: false, reason: "mismatch", shared: proof.phone };
  return { ok: true, phone: proof.phone };
}

/** "+251912345678" → "678": enough to tell two numbers apart, nothing more. */
export function lastDigits(phone: string, n = 3): string {
  return phone.replace(/\D/g, "").slice(-n);
}

/** What the registration page is told while it waits. */
export type SignupStatus =
  | { status: "pending" }
  | { status: "failed"; reason: SignupFailure; sharedEnding?: string; phoneEnding: string }
  | { status: "verified"; handoff?: string }
  | { status: "expired" };
