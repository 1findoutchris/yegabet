import "server-only";
import { randomBytes } from "node:crypto";
import { redis } from "@/lib/redis";
import { issueOtp } from "@/lib/otp";
import { tgCall } from "@/lib/telegram";
import { verifyDeepLink } from "@/lib/tgVerifyCore";

/*
 * Telegram phone verification for players — the rail that replaces SMS OTP.
 *
 * A separate bot from the payout-agent one in telegram.ts, on purpose: that bot
 * runs a username/password login state machine, and one chat cannot be
 * mid-agent-login and mid-signup at the same time.
 *
 * The shape of one verification:
 *
 *   1. The signup form calls beginVerification() and gets a t.me deep link
 *      carrying a one-time token.
 *   2. The user opens it; the bot asks for their contact (see tgVerifyCore for
 *      why the contact — and not merely pressing Start — is what proves
 *      anything).
 *   3. On a match, completeVerification() issues an ordinary OTP code. The user
 *      never sees or types it: the page polls for it and submits it to the same
 *      register / password-reset routes the SMS rail always used.
 *
 * So the code is now an internal handoff, and everything downstream of
 * verifyOtp() is unchanged.
 */

/** Long enough that a link can't be guessed, short enough for a t.me payload. */
const TOKEN_BYTES = 16;

/** How long a started verification stays open. Deliberately longer than the
 *  code's own 5 min: this window covers switching apps and installing Telegram. */
const TTL_PENDING = 10 * 60;

export type Purpose = "register" | "reset";
export type Pending = { purpose: Purpose; phone: string };

const tokenKey = (token: string) => `tgv:tok:${token}`;
const chatKey = (chatId: number) => `tgv:chat:${chatId}`;
const codeKey = (token: string) => `tgv:code:${token}`;
const phoneKey = (phone: string) => `tgv:phone:${phone}`;

/** Both halves must be set — a token without a bot username produces a link
 *  that goes nowhere, which on the signup form looks like a dead button. */
export function verifyBotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.TELEGRAM_VERIFY_BOT_TOKEN && !!env.TELEGRAM_VERIFY_BOT_USERNAME;
}

/** Send on the verification bot. Same fire-and-forget contract as tgSend. */
export function tgvSend(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  return tgCall(process.env.TELEGRAM_VERIFY_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** The keyboard that asks for the number. request_contact is the only way to
 *  get a phone number Telegram itself vouches for. */
export const CONTACT_KEYBOARD = {
  keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const REMOVE_KEYBOARD = { remove_keyboard: true };

/**
 * Open a verification and return the link to send the user to.
 *
 * Idempotent while one is already open for the number: re-submitting the form
 * hands back the same link, so the tab the user already has in Telegram stays
 * live — and an unauthenticated endpoint can't mint tokens without bound, which
 * is why this rail needs no send cooldown of its own.
 *
 * `phone` is stored exactly as the caller passed it, because that same string
 * is what register / password-reset will hand to verifyOtp — normalizing it
 * here would key the code under a different phone than the one looked up.
 */
export async function beginVerification(
  phone: string,
  purpose: Purpose,
): Promise<{ token: string; url: string }> {
  const open = await redis.get(phoneKey(phone));
  if (open && (await redis.get(tokenKey(open)))) {
    return { token: open, url: verifyDeepLink(open) };
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await redis.set(tokenKey(token), `${purpose}:${phone}`, "EX", TTL_PENDING);
  await redis.set(phoneKey(phone), token, "EX", TTL_PENDING);
  return { token, url: verifyDeepLink(token) };
}

export async function pendingForToken(token: string): Promise<Pending | null> {
  const raw = await redis.get(tokenKey(token));
  if (!raw) return null;
  const sep = raw.indexOf(":");
  const purpose = raw.slice(0, sep);
  if (purpose !== "register" && purpose !== "reset") return null;
  return { purpose, phone: raw.slice(sep + 1) };
}

/** Remember which verification this chat is answering, so the contact message
 *  that arrives next — which carries no token of its own — can be matched. */
export async function bindChat(chatId: number, token: string): Promise<void> {
  await redis.set(chatKey(chatId), token, "EX", TTL_PENDING);
}

/** Drop this chat's verification binding (a newer flow took over the chat). */
export async function unbindChat(chatId: number): Promise<void> {
  await redis.del(chatKey(chatId));
}

export async function tokenForChat(chatId: number): Promise<string | null> {
  return redis.get(chatKey(chatId));
}

/**
 * Mark the phone proven: issue the code the page will collect and submit.
 *
 * The token is consumed here so one link cannot be replayed into a second
 * account; the chat binding goes with it so a stray later contact message
 * doesn't re-open a finished verification.
 */
export async function completeVerification(token: string, chatId: number, phone: string): Promise<void> {
  const code = await issueOtp(phone);
  await redis.set(codeKey(token), code, "EX", 5 * 60);
  await redis.del(tokenKey(token), chatKey(chatId), phoneKey(phone));
}

/**
 * Hand the code to the page that started this verification, once.
 *
 * Consumed on read so the polling loop can't keep serving it after the page has
 * moved on — the code itself still has to survive verifyOtp, so this is a
 * second lock rather than the only one.
 */
export async function takeCode(token: string): Promise<string | null> {
  const code = await redis.get(codeKey(token));
  if (code) await redis.del(codeKey(token));
  return code;
}
