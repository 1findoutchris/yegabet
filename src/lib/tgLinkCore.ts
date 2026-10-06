// Linking a Telegram account to a VinnaBet account — the pure decision table,
// split out of tgLink.ts so every branch is testable without a database.

import { normalizePhone } from "./sms";
import type { TgContact } from "./tgVerifyCore";

/**
 * Every spelling of one Ethiopian mobile a `users.phone` row might hold.
 *
 * Signup has stored E.164 (+2519…) since the PhoneField prefix, but `phone` is
 * saved as submitted, so older rows or admin-created ones can hold another
 * form. Looking up all of them finds the account however it was typed, and
 * the caller refuses outright if more than one row matches.
 */
export function phoneVariants(e164: string): string[] {
  const local = e164.replace(/^\+251/, ""); // 9XXXXXXXX
  return [e164, `251${local}`, `0${local}`, local];
}

export type LinkCandidate = {
  id: string;
  isActive: boolean;
  role: string;
  telegramUserId: string | null;
};

export type LinkDecision =
  | { do: "link"; userId: string }
  | { do: "refresh"; userId: string }
  | { do: "reject"; reason: LinkRejection };

export type LinkRejection =
  | "not-own-contact"
  | "not-ethiopian"
  | "no-account"
  | "ambiguous"
  | "unavailable"
  | "telegram-in-use"
  | "account-has-other-telegram";

/**
 * Step 1 — before touching the database: is this contact card proof of
 * anything, and which number does it prove?
 *
 * Only a card whose user_id is the sender's own is vouched for by Telegram
 * (anyone can forward a card out of their address book, and a number typed
 * into the chat proves nothing at all). Returns the E.164 number or a reason.
 */
export function provenPhone(
  contact: TgContact,
  fromId: number,
): { ok: true; phone: string } | { ok: false; reason: "not-own-contact" | "not-ethiopian" } {
  if (typeof contact.user_id !== "number" || contact.user_id !== fromId) {
    return { ok: false, reason: "not-own-contact" };
  }
  const phone = typeof contact.phone_number === "string" ? normalizePhone(contact.phone_number) : null;
  return phone ? { ok: true, phone } : { ok: false, reason: "not-ethiopian" };
}

/**
 * Step 2 — given the accounts on that number and whoever already holds this
 * Telegram id, what happens?
 *
 * Nothing is ever moved silently:
 *   - a Telegram account already linked elsewhere stays there until it's
 *     unlinked (/unlink in the bot) — otherwise sharing a contact would
 *     quietly swap which account the Mini App signs into;
 *   - an account already linked to a *different* Telegram is left alone, so a
 *     recycled SIM can't take over Mini App sign-in for an account its old
 *     owner still uses. Support (admin "unlink-telegram") resolves it.
 *
 * In-person agents sign in only through their own portal (lib/auth.ts), so
 * Telegram must not become a second way in for them.
 */
export function linkDecision(
  telegramUserId: string,
  candidates: LinkCandidate[],
  holderId: string | null,
): LinkDecision {
  if (candidates.length === 0) return { do: "reject", reason: "no-account" };
  if (candidates.length > 1) return { do: "reject", reason: "ambiguous" };

  const [user] = candidates;
  if (!user.isActive || user.role === "IN_PERSON_AGENT") return { do: "reject", reason: "unavailable" };
  if (user.telegramUserId === telegramUserId) return { do: "refresh", userId: user.id };
  if (holderId && holderId !== user.id) return { do: "reject", reason: "telegram-in-use" };
  if (user.telegramUserId) return { do: "reject", reason: "account-has-other-telegram" };
  return { do: "link", userId: user.id };
}

/** "+251912345678" → "+251 9•• ••• 678" — enough to recognise, not to harvest. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 6) return "•••";
  return `+${d.slice(0, 3)} ${d.slice(3, 4)}•• ••• ${d.slice(-3)}`;
}
