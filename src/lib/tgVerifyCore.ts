// Pure decision table for Telegram phone verification, split out of tgVerify.ts
// so it's testable without redis or a bot token (same shape as otpCore).

import { normalizePhone } from "./sms";

/** What Telegram hands us when someone taps the "share contact" button. */
export type TgContact = {
  phone_number?: unknown;
  user_id?: unknown;
};

export type ContactResult = { ok: true } | { ok: false; message: string };

/**
 * Does this shared contact prove the sender owns `expected`?
 *
 * Two things have to hold, and the first one is the whole security argument:
 *
 *   1. `contact.user_id` must be the sender. Telegram lets anyone forward a
 *      contact card out of their address book, and those arrive as an ordinary
 *      contact message — without this check a user could "verify" any number
 *      they happen to have saved, which is strictly worse than the SMS rail it
 *      replaces. Only a card whose user_id is the sender's own is vouched for
 *      by Telegram.
 *   2. The number must match the one typed into the signup form, compared in
 *      E.164 so "0912…", "251912…" and "+251912…" are the same number.
 *
 * `expected` is already normalized by the caller (the send endpoint refuses
 * anything normalizePhone rejects), so a null here means the *contact* is
 * unusable, not the form input.
 */
export function contactVerdict(
  contact: TgContact,
  fromId: number,
  expected: string,
): ContactResult {
  if (typeof contact.user_id !== "number" || contact.user_id !== fromId) {
    return {
      ok: false,
      message:
        "That's someone else's contact card. Use the <b>Share my phone number</b> button below — it has to be your own number.",
    };
  }

  const shared = typeof contact.phone_number === "string" ? normalizePhone(contact.phone_number) : null;
  if (!shared) {
    return { ok: false, message: "That number isn't an Ethiopian mobile. Sign up with the number on this Telegram account." };
  }
  if (shared !== expected) {
    return {
      ok: false,
      message:
        `This Telegram account is <b>${shared}</b>, but you entered <b>${expected}</b>.\n\n` +
        "Go back and sign up with this number, or open the link again from a Telegram account that uses the number you entered.",
    };
  }

  return { ok: true };
}

/**
 * The token carried by `/start <token>`, or null for a bare /start or any
 * other message. Telegram allows [A-Za-z0-9_-] up to 64 chars in the payload,
 * so anything outside that was never one of ours and is rejected here rather
 * than becoming a redis lookup.
 */
export function startPayload(text: string): string | null {
  const m = /^\/start(?:@\S+)?\s+(\S+)$/.exec(text.trim());
  const token = m?.[1];
  return token && /^[A-Za-z0-9_-]{1,64}$/.test(token) ? token : null;
}

/** Where the signup form sends the user. Empty when the bot isn't configured. */
export function verifyDeepLink(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const bot = env.TELEGRAM_VERIFY_BOT_USERNAME;
  return bot ? `https://t.me/${bot.replace(/^@/, "")}?start=${token}` : "";
}
