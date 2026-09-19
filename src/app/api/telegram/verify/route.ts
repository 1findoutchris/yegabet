import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/sms";
import { contactVerdict, startPayload } from "@/lib/tgVerifyCore";
import {
  bindChat,
  completeVerification,
  pendingForToken,
  tokenForChat,
  tgvSend,
  CONTACT_KEYBOARD,
  REMOVE_KEYBOARD,
  type Purpose,
} from "@/lib/tgVerify";

/*
 * Webhook for the player phone-verification bot — the rail that replaced SMS
 * OTP. Separate bot and separate path from /api/telegram/webhook, which serves
 * the payout agents and runs its own login state machine.
 *
 * Point Telegram at it once:
 *   curl "https://api.telegram.org/bot<VERIFY_TOKEN>/setWebhook?url=<APP_URL>/api/telegram/verify&secret_token=<TELEGRAM_VERIFY_WEBHOOK_SECRET>"
 *
 * Two kinds of update matter: `/start <token>` opens a verification, and the
 * contact message that follows closes it. Everything else gets pointed back at
 * the website.
 */

const ok = () => NextResponse.json({ ok: true });

const HELP =
  "This bot confirms your phone number for <b>VinnaBet</b>.\n\n" +
  "Start from the sign-up form on the site — it will send you back here with your own link.";

const EXPIRED = "This link has expired. Go back to VinnaBet and start again.";

const NOTHING_PENDING =
  "There's nothing to confirm right now. Start from the VinnaBet sign-up form and open the link it gives you.";

/** Stated plainly, and the reset case says what to do if it wasn't them: this
 *  message is the only thing standing between a user and someone who talked
 *  them into confirming a reset they didn't ask for. */
function prompt(purpose: Purpose, phone: string): string {
  return purpose === "reset"
    ? `🔑 <b>VinnaBet password reset</b>\n\n` +
        `A password reset was requested for <b>${phone}</b>.\n\n` +
        `If that wasn't you, just ignore this message — nothing changes.\n\n` +
        `If it was, tap the button below to confirm the number is yours.`
    : `👋 <b>VinnaBet sign-up</b>\n\n` +
        `You're creating an account with <b>${phone}</b>.\n\n` +
        `Tap the button below to confirm this number is yours. Telegram sends us the ` +
        `number on this account — nothing else.`;
}

function done(purpose: Purpose): string {
  return purpose === "reset"
    ? "✅ Number confirmed.\n\nGo back to VinnaBet to set your new password."
    : "✅ Number confirmed.\n\nGo back to VinnaBet — your account is being created.";
}

export async function POST(req: NextRequest) {
  // Telegram echoes this header on every update; anyone who doesn't know it
  // doesn't get to drive the bot — and here that would mean forging
  // verifications outright.
  const expected = process.env.TELEGRAM_VERIFY_WEBHOOK_SECRET;
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId: unknown = msg?.chat?.id;
  const fromId: unknown = msg?.from?.id;
  if (typeof chatId !== "number" || typeof fromId !== "number") return ok();

  // Always 200 past this point: a 500 makes Telegram redeliver the same update
  // in a loop, and a redelivered contact would re-run a verification that has
  // already consumed its token.
  try {
    await handle(chatId, fromId, msg);
  } catch (err) {
    console.error("[telegram/verify] update failed", err);
  }
  return ok();
}

async function handle(chatId: number, fromId: number, msg: Record<string, unknown>): Promise<void> {
  if (msg.contact && typeof msg.contact === "object") {
    return handleContact(chatId, fromId, msg.contact as Record<string, unknown>);
  }

  const token = startPayload(typeof msg.text === "string" ? msg.text : "");
  if (!token) return tgvSend(chatId, HELP);

  const pending = await pendingForToken(token);
  if (!pending) return tgvSend(chatId, EXPIRED);

  await bindChat(chatId, token);
  return tgvSend(chatId, prompt(pending.purpose, pending.phone), CONTACT_KEYBOARD);
}

async function handleContact(
  chatId: number,
  fromId: number,
  contact: Record<string, unknown>,
): Promise<void> {
  const token = await tokenForChat(chatId);
  const pending = token ? await pendingForToken(token) : null;
  if (!token || !pending) return tgvSend(chatId, NOTHING_PENDING, REMOVE_KEYBOARD);

  // The send endpoint refuses anything normalizePhone can't parse, so the
  // fallback is unreachable — and if it ever weren't, comparing against the raw
  // string fails the match rather than passing it.
  const verdict = contactVerdict(contact, fromId, normalizePhone(pending.phone) ?? pending.phone);
  if (!verdict.ok) return tgvSend(chatId, verdict.message, CONTACT_KEYBOARD);

  await completeVerification(token, chatId, pending.phone);
  return tgvSend(chatId, done(pending.purpose), REMOVE_KEYBOARD);
}
