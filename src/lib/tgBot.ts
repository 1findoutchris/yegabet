import "server-only";
import { tgCall } from "@/lib/telegram";

/*
 * The VinnaBet player bot: main menu, account linking, ticket checks and the
 * Mini App launcher.
 *
 * It is the same bot as the signup phone-verification rail (tgVerify.ts) —
 * TELEGRAM_VERIFY_BOT_* — so players have one VinnaBet bot, and the Mini App
 * it launches is validated with that bot's token. It is NOT the payout-agent
 * bot (TELEGRAM_BOT_TOKEN, lib/telegram.ts), whose chats run an agent login
 * state machine.
 */

type Markup = Record<string, unknown>;

/** Send on the player bot. Same fire-and-forget contract as tgSend. */
export function botSend(chatId: number, text: string, replyMarkup?: Markup): Promise<void> {
  return tgCall(process.env.TELEGRAM_VERIFY_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** Clears the spinner on a tapped inline button. */
export function answerCallback(id: string, text?: string): Promise<void> {
  return tgCall(process.env.TELEGRAM_VERIFY_BOT_TOKEN, "answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  });
}

/**
 * The Mini App's address, optionally opening on a section (`?to=` goes through
 * the tgStartCore allow-list on the page, same as a startapp parameter).
 *
 * Telegram only opens web_app buttons over HTTPS, so anything else — a
 * missing or http:// URL in development — yields "" and the buttons that
 * need it are left out rather than sent and rejected.
 */
export function miniAppUrl(to?: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.TELEGRAM_WEBAPP_URL || (env.NEXT_PUBLIC_APP_URL ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/tg` : "");
  if (!base.startsWith("https://")) return "";
  if (!to) return base;
  const u = new URL(base);
  u.searchParams.set("to", to);
  return u.toString();
}

export function supportUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.TELEGRAM_SUPPORT_URL || "https://t.me/vinnabet";
}

function webAppButton(text: string, to?: string) {
  const url = miniAppUrl(to);
  return url ? [{ text, web_app: { url } }] : [];
}

// ── keyboards ───────────────────────────────────────────────────────────────

/** Callback data for the inline menu. Short: Telegram caps it at 64 bytes. */
export const CB = { verify: "m:verify", ticket: "m:ticket", support: "m:support", account: "m:account", another: "m:another" } as const;

export function mainMenu(): Markup {
  const rows = [
    [{ text: "📱 Verify Phone Number", callback_data: CB.verify }],
    webAppButton("🎰 Open VinnaBet"),
    [{ text: "🎫 Check Ticket", callback_data: CB.ticket }],
    [{ text: "💬 Support", callback_data: CB.support }],
  ];
  return { inline_keyboard: rows.filter((r) => r.length) };
}

/**
 * The reply keyboard that asks for the user's own number. request_contact is
 * the only way to get a phone Telegram vouches for — and even then the
 * webhook checks the card's user_id is the sender before believing it.
 */
export const SHARE_CONTACT_KEYBOARD: Markup = {
  keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
  input_field_placeholder: "Tap the button below",
};

export const REMOVE: Markup = { remove_keyboard: true };

export function openAppMarkup(text = "🎰 Open VinnaBet", to?: string): Markup | undefined {
  const row = webAppButton(text, to);
  return row.length ? { inline_keyboard: [row] } : undefined;
}

export function noAccountMarkup(): Markup {
  const site = process.env.NEXT_PUBLIC_APP_URL;
  const rows = [
    webAppButton("➕ Create Account", "home"),
    // A URL button too, for anyone whose client can't open Mini Apps.
    ...(site?.startsWith("https://") ? [[{ text: "🌐 Sign up on the website", url: site }]] : []),
    [{ text: "🔁 Try Another Account Method", callback_data: CB.another }],
  ];
  return { inline_keyboard: rows.filter((r) => r.length) };
}

// ── copy ────────────────────────────────────────────────────────────────────

export const WELCOME =
  "🏆 <b>Welcome to VinnaBet</b>\n\n" +
  "Sports, casino and games — with your real VinnaBet wallet, right inside Telegram.\n\n" +
  "• <b>Verify Phone Number</b> links this Telegram to your VinnaBet account, so the app signs you in automatically.\n" +
  "• <b>Open VinnaBet</b> launches the app.\n" +
  "• <b>Check Ticket</b> looks up any ticket code.";

export const VERIFY_PROMPT =
  "📱 <b>Link your VinnaBet account</b>\n\n" +
  "Tap <b>Share my phone number</b> below. Telegram sends us the number on <i>this</i> Telegram account " +
  "and we match it to your VinnaBet account — nothing else is shared.\n\n" +
  "Typing a number in the chat won't work: it has to come from the button.";

export const TICKET_PROMPT =
  "🎫 <b>Check a ticket</b>\n\nSend the ticket code (e.g. <code>T3F9K2A</code> or <code>P7KX2M9QD</code>), " +
  "or open Check Ticket to scan the barcode.";

export function helpText(): string {
  return (
    "ℹ️ <b>VinnaBet bot</b>\n\n" +
    "/start — main menu\n" +
    "/account — your linked account\n" +
    "/verify — link this Telegram to your VinnaBet account\n" +
    "/ticket — check a ticket\n" +
    "/unlink — disconnect this Telegram from VinnaBet\n" +
    "/help — this message\n\n" +
    `Need help? Contact support: ${supportUrl()}`
  );
}

export const ANOTHER_METHOD =
  "🔁 <b>Other ways in</b>\n\n" +
  "• If your VinnaBet account uses a different phone number, open VinnaBet and log in with that number and your password.\n" +
  "• Then come back here from the Telegram account that has that number, and tap <b>Verify Phone Number</b>.\n" +
  "• New to VinnaBet? Tap <b>Create Account</b>.";
