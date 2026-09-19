import type { Prisma } from "@prisma/client";
import { formatCurrency } from "./utils";

/*
 * Telegram bot for payout agents.
 *
 * The bot is a notifier and a read-only balance check — every action (marking
 * a withdrawal paid, uploading proof) still happens in the payout portal, so
 * there is exactly one place where money moves. Each request message carries a
 * button straight into that portal.
 */

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** The payout portal an agent is sent to. Empty when the portal isn't configured. */
export function portalUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.PAYOUT_SECRET;
  if (!base || !secret) return "";
  return `${base}/payout/${secret}`;
}

/**
 * One Bot API call. Fire-and-forget: a dead bot token must never break a
 * withdrawal or a signup.
 *
 * The token is a parameter rather than read from env here because there are two
 * bots — this payout-agent one and the player-verification one in tgVerify.ts —
 * and sending on the wrong token fails silently.
 */
export async function tgCall(
  token: string | undefined,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Telegram being unreachable is not the caller's problem.
  }
}

/** Send a message on the payout-agent bot, optionally with a link button. */
export async function tgSend(chatId: string | number, text: string, button?: { text: string; url: string }): Promise<void> {
  return tgCall(process.env.TELEGRAM_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(button?.url ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  });
}

// ── the login state machine ─────────────────────────────────────────────────

/** Redis value meaning "we asked for a username and are waiting for it". */
export const AWAITING_USERNAME = "?";

export type BotAction =
  | { do: "ask-username" }
  | { do: "ask-password"; username: string }
  | { do: "login"; username: string; password: string }
  | { do: "balance" }
  | { do: "logout" }
  | { do: "help" };

/**
 * Decide what to do with one incoming message, given the pending-login state
 * (null = nothing pending, "?" = awaiting username, anything else = the
 * username we already collected and are awaiting the password for).
 *
 * A command always wins over a pending step, so an agent who typed /login by
 * mistake can still reach /balance instead of having it swallowed as a
 * password. Agent passwords are alphanumeric, so nothing legitimate is lost.
 */
export function botStep(pending: string | null, text: string): BotAction {
  const trimmed = text.trim();

  if (trimmed.startsWith("/")) {
    // "/balance@VinnaPayoutBot" is what Telegram delivers in groups.
    const cmd = trimmed.split(/[\s@]/)[0].toLowerCase();
    if (cmd === "/start" || cmd === "/login") return { do: "ask-username" };
    if (cmd === "/balance") return { do: "balance" };
    if (cmd === "/logout" || cmd === "/cancel") return { do: "logout" };
    return { do: "help" };
  }

  if (pending === AWAITING_USERNAME) {
    return trimmed ? { do: "ask-password", username: trimmed } : { do: "ask-username" };
  }
  if (pending) return { do: "login", username: pending, password: text };

  return { do: "help" };
}

export const HELP =
  "Payout agent bot\n\n" +
  "/login — sign in (username, then password)\n" +
  "/balance — what the platform owes you\n" +
  "/logout — unlink this chat\n\n" +
  "New withdrawal requests assigned to you arrive here automatically.";

// ── outbound notifications ──────────────────────────────────────────────────

/**
 * Tell the assigned payout agent about a request. Called after the transaction
 * commits — never inside it, since a slow Telegram call would hold a row lock
 * on the player's balance.
 *
 * Silently does nothing when the request is unassigned or the agent has not
 * linked a chat, which is the normal case for agents who don't use the bot.
 */
export async function notifyNewWithdrawal(db: Prisma.TransactionClient, requestId: string): Promise<void> {
  if (!telegramConfigured()) return;

  const r = await db.withdrawalRequest.findUnique({
    where: { id: requestId },
    select: {
      publicId: true, amount: true, method: true, account: true, accountName: true,
      withdrawalAgent: { select: { telegramChatId: true } },
      user: { select: { accountNo: true, username: true } },
    },
  }).catch(() => null);

  const chatId = r?.withdrawalAgent?.telegramChatId;
  if (!r || !chatId) return;

  const text =
    `🔔 <b>New withdrawal</b> ${r.publicId ?? ""}\n\n` +
    `Amount: <b>${formatCurrency(r.amount)}</b>\n` +
    `Method: ${r.method}\n` +
    `To: <code>${r.account}</code> — ${r.accountName}\n` +
    `Player: #${r.user.accountNo ?? "—"} (${r.user.username})`;

  const url = portalUrl();
  await tgSend(chatId, text, url ? { text: "Open dashboard →", url } : undefined);
}
