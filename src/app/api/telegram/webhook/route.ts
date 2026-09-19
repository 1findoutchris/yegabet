import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { agentOutstanding } from "@/lib/agentSettlements";
import { botStep, tgSend, portalUrl, AWAITING_USERNAME, HELP } from "@/lib/telegram";
import { formatCurrency } from "@/lib/utils";

/*
 * Telegram webhook for the payout-agent bot.
 *
 * Point Telegram at it once:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 * The bot only reads. Marking a withdrawal paid still happens in the portal —
 * every message carries a button into it.
 */

/** Half-finished logins expire fast; a password prompt left open is a liability. */
const LOGIN_TTL = 5 * 60;
const MAX_FAILURES = 5;
const FAILURE_WINDOW = 15 * 60;

const pendingKey = (chatId: number) => `tg:login:${chatId}`;
const failKey = (chatId: number) => `tg:fail:${chatId}`;

const ok = () => NextResponse.json({ ok: true });

function dashboardButton() {
  const url = portalUrl();
  return url ? { text: "Open dashboard →", url } : undefined;
}

export async function POST(req: NextRequest) {
  // Telegram echoes this header back on every update; anyone who doesn't know
  // it doesn't get to drive the bot.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId: number | undefined = msg?.chat?.id;
  const text: unknown = msg?.text;
  if (typeof chatId !== "number" || typeof text !== "string") return ok();

  // Always 200 past this point: a 500 makes Telegram redeliver the same update
  // in a loop, which for a login attempt means replaying the password.
  try {
    await handle(chatId, text);
  } catch (err) {
    console.error("[telegram] update failed", err);
  }
  return ok();
}

async function handle(chatId: number, text: string): Promise<void> {
  const pending = await redis.get(pendingKey(chatId));
  const action = botStep(pending, text);

  switch (action.do) {
    case "ask-username":
      await redis.set(pendingKey(chatId), AWAITING_USERNAME, "EX", LOGIN_TTL);
      return tgSend(chatId, "Send your agent <b>username</b>.");

    case "ask-password":
      await redis.set(pendingKey(chatId), action.username, "EX", LOGIN_TTL);
      return tgSend(
        chatId,
        "Now send your <b>password</b>.\n\n⚠️ Delete that message afterwards — Telegram keeps your chat history.",
      );

    case "login": {
      await redis.del(pendingKey(chatId));

      // Guessing a password over a chat app is otherwise unlimited and silent.
      const fails = await redis.incr(failKey(chatId));
      if (fails === 1) await redis.expire(failKey(chatId), FAILURE_WINDOW);
      if (fails > MAX_FAILURES) {
        return tgSend(chatId, "Too many failed attempts. Try again in 15 minutes.");
      }

      const agent = await prisma.withdrawalAgent.findUnique({
        where: { username: action.username },
        select: { id: true, name: true, username: true, passwordHash: true, isActive: true },
      });
      // One message for every failure mode, same as the portal login — the bot
      // must not become a way to probe which usernames exist.
      if (!agent || !agent.isActive || !(await bcrypt.compare(action.password, agent.passwordHash))) {
        return tgSend(chatId, "Invalid credentials. Send /login to try again.");
      }

      await redis.del(failKey(chatId));
      // The chat is unique per agent, so release it from whoever held it before
      // rather than failing on the constraint.
      await prisma.withdrawalAgent.updateMany({
        where: { telegramChatId: String(chatId) },
        data: { telegramChatId: null },
      });
      await prisma.withdrawalAgent.update({
        where: { id: agent.id },
        data: { telegramChatId: String(chatId) },
      });

      return tgSend(
        chatId,
        `✅ Signed in as <b>${agent.name ?? agent.username}</b>.\n\n` +
          "New withdrawal requests routed to you will arrive here.\n" +
          "Send /balance any time.",
        dashboardButton(),
      );
    }

    case "balance": {
      const agent = await prisma.withdrawalAgent.findUnique({
        where: { telegramChatId: String(chatId) },
        select: { id: true, name: true, username: true, commissionRate: true },
      });
      if (!agent) return tgSend(chatId, "You're not signed in. Send /login.");

      const outstanding = await agentOutstanding(agent.id);
      const open = await prisma.withdrawalRequest.count({
        where: { withdrawalAgentId: agent.id, status: { in: ["PENDING", "PROCESSING"] } },
      });

      return tgSend(
        chatId,
        `💰 <b>${agent.name ?? agent.username}</b>\n\n` +
          `Owed to you: <b>${formatCurrency(outstanding)}</b>\n` +
          `Commission rate: ${Number(agent.commissionRate)}%\n` +
          `Open requests: ${open}`,
        dashboardButton(),
      );
    }

    case "logout":
      await redis.del(pendingKey(chatId));
      await prisma.withdrawalAgent.updateMany({
        where: { telegramChatId: String(chatId) },
        data: { telegramChatId: null },
      });
      return tgSend(chatId, "Signed out. This chat will stop receiving requests.");

    case "help":
      return tgSend(chatId, HELP, dashboardButton());
  }
}
