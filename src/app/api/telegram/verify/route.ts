import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { normalizePhone } from "@/lib/sms";
import { contactVerdict, startPayload } from "@/lib/tgVerifyCore";
import {
  bindChat,
  completeVerification,
  pendingForToken,
  tokenForChat,
  tgvSend,
  unbindChat,
  CONTACT_KEYBOARD,
  REMOVE_KEYBOARD,
  type Purpose,
} from "@/lib/tgVerify";
import { linkByContact, linkedUser, rememberOutcome, unlinkTelegram, type LinkResult, type TgSender } from "@/lib/tgLink";
import { maskPhone } from "@/lib/tgLinkCore";
import { esc, parseCommand, ticketSummary } from "@/lib/tgBotCore";
import { startPath, ticketStartParam } from "@/lib/tgStartCore";
import {
  ANOTHER_METHOD,
  CB,
  REMOVE,
  SHARE_CONTACT_KEYBOARD,
  TICKET_PROMPT,
  VERIFY_PROMPT,
  WELCOME,
  answerCallback,
  botSend,
  helpText,
  mainMenu,
  noAccountMarkup,
  openAppMarkup,
  signupDoneMarkup,
} from "@/lib/tgBot";
import { allowCheck, checkTicket, normalizeCode } from "@/lib/ticketCheck";
import { BOT_HANDOFF_TTL, issueHandoff } from "@/lib/authHandoff";
import { lastDigits } from "@/lib/tgSignupCore";
import {
  bindSignupChat,
  completeSignup,
  getPending,
  signupTokenForChat,
  unbindSignupChat,
  type PendingSignup,
} from "@/lib/tgSignup";
import { formatCurrency } from "@/lib/utils";

/*
 * Webhook for the VinnaBet player bot (TELEGRAM_VERIFY_BOT_*). Separate bot
 * and separate path from /api/telegram/webhook, which serves the payout agents
 * and runs its own login state machine.
 *
 * Register it (plus commands and the menu button) with:
 *   node --env-file=.env scripts/telegram-setup.mjs
 *
 * Two jobs share the bot:
 *
 *   1. Signup / password-reset phone verification (the original job, see
 *      lib/tgVerify.ts): `/start <token>` opens one, the contact that follows
 *      closes it. Whenever a verification is pending for the chat, a contact
 *      belongs to it — exactly as before.
 *   2. Everything else: the main menu, linking this Telegram to an existing
 *      VinnaBet account (lib/tgLink.ts), /account, /ticket and the Mini App.
 *
 * Only a contact card whose user_id is the sender ever proves a number —
 * typed numbers are refused, forwarded cards are refused.
 */

const ok = () => NextResponse.json({ ok: true });

/** Telegram retries an update until it gets a 2xx; remember ids for a day so
 *  a retry (or a replay of a captured request) is processed once. */
const UPDATE_TTL = 24 * 60 * 60;
/** "Send me the ticket code" stays open this long. */
const AWAIT_TTL = 5 * 60;

const awaitKey = (chatId: number) => `tgbot:await:${chatId}`;

const EXPIRED = "This link has expired. Go back to VinnaBet and start again.";

/** Signup tokens are 16 random bytes in hex (tgVerify.TOKEN_BYTES). */
const SIGNUP_TOKEN = /^[0-9a-f]{32}$/;

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

function secretMatches(got: string | null): boolean {
  const expected = process.env.TELEGRAM_VERIFY_WEBHOOK_SECRET;
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Telegram echoes this header on every update; anyone who doesn't know it
  // doesn't get to drive the bot — and here that would mean forging
  // verifications outright.
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") return ok();

  // Always 200 past this point: a 500 makes Telegram redeliver the same update
  // in a loop, and a redelivered contact would re-run a verification that has
  // already consumed its token.
  try {
    if (typeof update.update_id === "number") {
      const first = await redis.set(`tgbot:upd:${update.update_id}`, "1", "EX", UPDATE_TTL, "NX");
      if (first === null) return ok();
    }
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (err) {
    console.error("[telegram/verify] update failed", err);
  }
  return ok();
}

// ── messages ────────────────────────────────────────────────────────────────

type Msg = Record<string, unknown> & {
  chat?: { id?: unknown; type?: unknown };
  from?: { id?: unknown; username?: unknown; first_name?: unknown; is_bot?: unknown };
};

function sender(from: Msg["from"]): TgSender | null {
  if (!from || typeof from.id !== "number" || from.is_bot === true) return null;
  return {
    id: from.id,
    username: typeof from.username === "string" ? from.username : undefined,
    first_name: typeof from.first_name === "string" ? from.first_name : undefined,
  };
}

async function handleMessage(msg: Msg): Promise<void> {
  const chatId = msg.chat?.id;
  const from = sender(msg.from);
  // Private chats only: the menu, linking and account summaries are personal,
  // and web_app buttons don't work in groups anyway.
  if (typeof chatId !== "number" || !from || msg.chat?.type !== "private") return;

  if (msg.contact && typeof msg.contact === "object") {
    return handleContact(chatId, from, msg.contact as Record<string, unknown>);
  }

  const text = typeof msg.text === "string" ? msg.text : "";
  const command = parseCommand(text);

  if (command?.cmd === "start" && command.arg) {
    // A registration link (lib/tgSignup) or a password-reset / legacy signup
    // verification link (lib/tgVerify). Same token shape, separate stores.
    const token = startPayload(text);
    if (token && SIGNUP_TOKEN.test(token)) {
      const registration = await getPending(token);
      if (registration) return startRegistration(chatId, from, token, registration);

      const pending = await pendingForToken(token);
      if (!pending) return tgvSend(chatId, EXPIRED);
      await unbindSignupChat(chatId);
      await bindChat(chatId, token);
      return tgvSend(chatId, prompt(pending.purpose, pending.phone), CONTACT_KEYBOARD);
    }
    return handleStartParam(chatId, from, command.arg);
  }

  if (command) {
    if (command.cmd !== "ticket") await redis.del(awaitKey(chatId));
    switch (command.cmd) {
      case "start":
      case "menu":
        return botSend(chatId, WELCOME, mainMenu());
      case "account":
        return sendAccount(chatId, from);
      case "verify":
        return botSend(chatId, VERIFY_PROMPT, SHARE_CONTACT_KEYBOARD);
      case "ticket":
        return command.arg ? sendTicket(chatId, from, command.arg) : askTicket(chatId);
      case "unlink":
        return sendUnlink(chatId, from);
      case "cancel":
        return botSend(chatId, "Cancelled.", REMOVE);
      case "help":
        return botSend(chatId, helpText(), mainMenu());
    }
  }

  // Plain text. A ticket code is looked up whether or not we asked for one.
  const awaiting = await redis.get(awaitKey(chatId));
  if (awaiting || normalizeCode(text)) {
    await redis.del(awaitKey(chatId));
    return sendTicket(chatId, from, text);
  }

  // A typed number proves nothing — say so instead of silently ignoring it.
  if (normalizePhone(text) || /^\+?[\d\s()-]{9,}$/.test(text.trim())) {
    return botSend(
      chatId,
      "For your security we can't use a number typed into the chat. Tap <b>Share my phone number</b> below instead.",
      SHARE_CONTACT_KEYBOARD,
    );
  }

  return botSend(chatId, WELCOME, mainMenu());
}

/** `/start <param>` from a t.me/<bot>?start= link. Navigation only. */
async function handleStartParam(chatId: number, from: TgSender, param: string): Promise<void> {
  const p = param.toLowerCase();
  if (p === "verify" || p === "link") return botSend(chatId, VERIFY_PROMPT, SHARE_CONTACT_KEYBOARD);
  if (p === "account") return sendAccount(chatId, from);
  if (p.startsWith("ticket_")) return sendTicket(chatId, from, param.slice("ticket_".length));
  if (p === "ticket" || p === "check") return askTicket(chatId);

  // Anything else the Mini App understands (game_…, sports, …) opens it there.
  if (startPath(param)) {
    const markup = openAppMarkup("🎰 Open VinnaBet", param);
    if (markup) return botSend(chatId, "Tap below to open VinnaBet.", markup);
  }
  return botSend(chatId, WELCOME, mainMenu());
}

// ── callbacks (inline menu buttons) ─────────────────────────────────────────

async function handleCallback(cq: Record<string, unknown>): Promise<void> {
  const id = typeof cq.id === "string" ? cq.id : null;
  const from = sender(cq.from as Msg["from"]);
  const chat = (cq.message as Msg | undefined)?.chat;
  if (id) await answerCallback(id);
  if (!from || typeof chat?.id !== "number" || chat.type !== "private") return;
  const chatId = chat.id;

  switch (cq.data) {
    case CB.verify:
      return botSend(chatId, VERIFY_PROMPT, SHARE_CONTACT_KEYBOARD);
    case CB.ticket:
      return askTicket(chatId);
    case CB.support:
      return botSend(chatId, helpText());
    case CB.account:
      return sendAccount(chatId, from);
    case CB.another:
      return botSend(chatId, ANOTHER_METHOD, noAccountMarkup());
  }
}

// ── contact: signup verification or account linking ─────────────────────────

async function handleContact(chatId: number, from: TgSender, contact: Record<string, unknown>): Promise<void> {
  // A registration in progress owns the contact first.
  const regToken = await signupTokenForChat(chatId);
  if (regToken) return handleRegistrationContact(chatId, from, regToken, contact);

  // A pending reset / legacy signup verification next, exactly as before.
  const token = await tokenForChat(chatId);
  const pending = token ? await pendingForToken(token) : null;
  if (token && pending) {
    // The send endpoint refuses anything normalizePhone can't parse, so the
    // fallback is unreachable — and if it ever weren't, comparing against the
    // raw string fails the match rather than passing it.
    const verdict = contactVerdict(contact, from.id, normalizePhone(pending.phone) ?? pending.phone);
    if (!verdict.ok) return tgvSend(chatId, verdict.message, CONTACT_KEYBOARD);

    await completeVerification(token, chatId, pending.phone);
    return tgvSend(chatId, done(pending.purpose), REMOVE_KEYBOARD);
  }

  const result = await linkByContact(contact, from);
  if (!result.ok) await rememberOutcome(from.id, result.reason);
  return replyToLink(chatId, result);
}

async function replyToLink(chatId: number, r: LinkResult): Promise<void> {
  if (r.ok) {
    const who = r.name ? ` (${esc(r.name)})` : "";
    await botSend(
      chatId,
      r.relinked
        ? `✅ Number re-confirmed. This Telegram is linked to VinnaBet account <b>#${r.accountNo}</b>${who}.`
        : `✅ <b>Linked!</b>\n\nThis Telegram is now connected to VinnaBet account <b>#${r.accountNo}</b>${who}, ` +
            `${maskPhone(r.phone)}.\n\nOpen VinnaBet below — you'll be signed in automatically.`,
      REMOVE,
    );
    const markup = openAppMarkup();
    if (markup) await botSend(chatId, "Ready when you are 👇", markup);
    return;
  }

  switch (r.reason) {
    case "not-own-contact":
      return botSend(
        chatId,
        "That's someone else's contact card. Use the <b>Share my phone number</b> button below — it has to be your own number.",
        SHARE_CONTACT_KEYBOARD,
      );
    case "not-ethiopian":
      await botSend(chatId, "This Telegram account's number isn't an Ethiopian mobile, so it can't match a VinnaBet account.", REMOVE);
      return botSend(chatId, "What would you like to do?", noAccountMarkup());
    case "no-account":
      await botSend(chatId, "No VinnaBet account was found for this phone number.", REMOVE);
      return botSend(chatId, "What would you like to do?", noAccountMarkup());
    case "telegram-in-use":
      return botSend(
        chatId,
        "This Telegram account is already linked to a different VinnaBet account.\n\n" +
          "Send /unlink to disconnect it first, then verify again.",
        REMOVE,
      );
    case "account-has-other-telegram":
      return botSend(
        chatId,
        "That VinnaBet account is already linked to another Telegram account.\n\n" +
          "If you no longer use that Telegram account, contact support to move the link.\n" + helpText(),
        REMOVE,
      );
    case "ambiguous":
    case "unavailable":
      return botSend(chatId, "This account can't be linked from Telegram. Please contact support.\n\n" + helpText(), REMOVE);
  }
}

// ── account / ticket / unlink ───────────────────────────────────────────────

async function sendAccount(chatId: number, from: TgSender): Promise<void> {
  const user = await linkedUser(from.id);
  if (!user) {
    return botSend(
      chatId,
      "This Telegram isn't linked to a VinnaBet account yet.\n\nTap <b>Verify Phone Number</b> to link it.",
      { inline_keyboard: [[{ text: "📱 Verify Phone Number", callback_data: CB.verify }]] },
    );
  }
  return botSend(
    chatId,
    `👤 <b>${esc(user.name ?? user.username)}</b>\n\n` +
      `Account: <b>#${user.accountNo}</b>\n` +
      `Phone: ${maskPhone(user.phone)}\n` +
      `Balance: <b>${formatCurrency(user.balance)}</b>\n` +
      `Tier: ${user.loyaltyTier} · ${user.loyaltyPoints.toLocaleString("en-US")} XP`,
    openAppMarkup("💼 Open my wallet", "wallet"),
  );
}

async function askTicket(chatId: number): Promise<void> {
  await redis.set(awaitKey(chatId), "1", "EX", AWAIT_TTL);
  return botSend(chatId, TICKET_PROMPT, openAppMarkup("📷 Scan in Check Ticket", "check"));
}

async function sendTicket(chatId: number, from: TgSender, raw: string): Promise<void> {
  // Same throttle as the public Check Ticket page, keyed per Telegram user.
  if (!(await allowCheck(`tg:${from.id}`))) {
    return botSend(chatId, "Too many checks — wait a minute and try again.");
  }
  if (!normalizeCode(raw)) {
    return botSend(chatId, "That doesn't look like a ticket code. It looks like <code>T3F9K2A</code> or <code>P7KX2M9QD</code>.");
  }
  const ticket = await checkTicket(raw);
  if (!ticket) return botSend(chatId, "Ticket not found. Check the code and try again.");
  const param = ticketStartParam(ticket.publicId);
  return botSend(chatId, ticketSummary(ticket), param ? openAppMarkup("🔎 View in VinnaBet", param) : undefined);
}

async function sendUnlink(chatId: number, from: TgSender): Promise<void> {
  const had = await unlinkTelegram(from.id);
  return botSend(
    chatId,
    had
      ? "Disconnected. This Telegram no longer signs in to VinnaBet. Your account, wallet and bets are unchanged."
      : "This Telegram isn't linked to a VinnaBet account.",
    REMOVE,
  );
}

// ── Telegram-verified registration (lib/tgSignup.ts) ───────────────────────

async function startRegistration(chatId: number, from: TgSender, token: string, reg: PendingSignup): Promise<void> {
  if (reg.state === "done" && reg.userId) return sendRegistrationDone(chatId, from, reg.userId, null);

  // This chat now answers the registration, not an older verification.
  await unbindChat(chatId);
  await bindSignupChat(chatId, token);
  return botSend(
    chatId,
    "📝 <b>Create your VinnaBet account</b>\n\n" +
      `You're registering the phone number ending in <b>${lastDigits(reg.phone)}</b>.\n\n` +
      "Only continue if you just filled in the VinnaBet sign-up form yourself.\n\n" +
      "Tap <b>Share my phone number</b> below — it has to be this Telegram account's own number. " +
      "A number typed into the chat can't be accepted.",
    SHARE_CONTACT_KEYBOARD,
  );
}

async function handleRegistrationContact(
  chatId: number,
  from: TgSender,
  token: string,
  contact: Record<string, unknown>,
): Promise<void> {
  const r = await completeSignup(token, contact, from);

  switch (r.kind) {
    case "busy":
      return; // a duplicate delivery of the same contact is already being handled
    case "expired":
      await unbindSignupChat(chatId);
      return botSend(
        chatId,
        "This sign-up link has expired. Go back to VinnaBet and tap <b>Create Account</b> again.",
        REMOVE,
      );
    case "created":
      await unbindSignupChat(chatId);
      return sendRegistrationDone(chatId, from, r.userId, r.accountNo);
    case "already":
      await unbindSignupChat(chatId);
      if (r.sameTelegram) return sendRegistrationDone(chatId, from, r.userId, r.accountNo);
      return botSend(chatId, "This registration was already completed from another Telegram account.", REMOVE);
    case "failed":
      return sendRegistrationFailure(chatId, r.reason, r.pending);
  }
}

async function sendRegistrationFailure(chatId: number, reason: string, reg: PendingSignup): Promise<void> {
  const entered = lastDigits(reg.phone);
  switch (reason) {
    case "not-own-contact":
      return botSend(
        chatId,
        "That's someone else's contact card. Use the <b>Share my phone number</b> button below — it has to be your own number.",
        SHARE_CONTACT_KEYBOARD,
      );
    case "mismatch":
      return botSend(
        chatId,
        `❌ <b>The numbers don't match</b>\n\n` +
          `This Telegram account's number ends in <b>${esc(reg.sharedEnding ?? "")}</b>, ` +
          `but the sign-up form has a number ending in <b>${entered}</b>.\n\n` +
          "Go back to the VinnaBet sign-up page and correct your number, or open the link " +
          "from the Telegram account that uses the number you entered.",
        REMOVE,
      );
    case "not-ethiopian":
      return botSend(
        chatId,
        "This Telegram account's number isn't an Ethiopian mobile, so it can't verify a VinnaBet account. " +
          "Go back to the sign-up page and use the Telegram account with your Ethiopian number.",
        REMOVE,
      );
    case "telegram-in-use":
      await botSend(chatId, "This Telegram account already has a VinnaBet account — no new account was created.", REMOVE);
      return botSend(chatId, "Open VinnaBet to sign in to it:", openAppMarkup());
    case "phone-taken":
      return botSend(
        chatId,
        "That phone number already has a VinnaBet account, so no new account was created. " +
          "Log in on VinnaBet with your number and password (or use Forgot password).",
        REMOVE,
      );
  }
}

/**
 * The account exists. Offer both ways in: the Mini App (the account is
 * already linked to this Telegram, so it signs in by itself) and the website
 * through a fresh one-time login handoff — issued only to the Telegram
 * account that verified the number.
 */
async function sendRegistrationDone(chatId: number, from: TgSender, userId: string, accountNo: number | null): Promise<void> {
  const user = await linkedUser(from.id);
  if (!user || user.id !== userId) {
    return botSend(chatId, "This registration was already completed. Log in on VinnaBet to continue.", REMOVE);
  }
  await botSend(
    chatId,
    `✅ <b>Number confirmed — welcome to VinnaBet!</b>\n\nYour account <b>#${accountNo ?? user.accountNo}</b> is ready ` +
      "and linked to this Telegram.",
    REMOVE,
  );
  const handoff = await issueHandoff(userId, BOT_HANDOFF_TTL);
  const markup = signupDoneMarkup(handoff);
  return botSend(chatId, "Where would you like to play?", markup);
}
