#!/usr/bin/env node
/*
 * One-time (and re-runnable) setup for the VinnaBet player bot:
 * webhook, command list, "Open VinnaBet" menu button and bot descriptions.
 *
 *   node --env-file=.env scripts/telegram-setup.mjs
 *
 * Reads (never prints) the token from the environment:
 *   TELEGRAM_VERIFY_BOT_TOKEN       the player bot's token (@BotFather)
 *   TELEGRAM_VERIFY_WEBHOOK_SECRET  echoed by Telegram on every update
 *   NEXT_PUBLIC_APP_URL             https://vinna.bet
 *   TELEGRAM_WEBAPP_URL             optional; defaults to <APP_URL>/tg
 *
 * Idempotent: every call sets state, so running it again after changing a
 * value just updates the bot.
 */

const token = process.env.TELEGRAM_VERIFY_BOT_TOKEN;
const secret = process.env.TELEGRAM_VERIFY_WEBHOOK_SECRET;
const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
const webApp = process.env.TELEGRAM_WEBAPP_URL || (app ? `${app}/tg` : "");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!token) fail("TELEGRAM_VERIFY_BOT_TOKEN is not set");
if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  fail("TELEGRAM_VERIFY_WEBHOOK_SECRET must be 1-256 chars of A-Z a-z 0-9 _ -");
}
if (!app.startsWith("https://")) fail("NEXT_PUBLIC_APP_URL must be an https:// URL (Telegram requires HTTPS)");
if (!webApp.startsWith("https://")) fail("TELEGRAM_WEBAPP_URL must be an https:// URL");

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) fail(`${method}: ${data.description ?? res.status}`);
  console.log(`✓ ${method}`);
  return data.result;
}

await call("setWebhook", {
  url: `${app}/api/telegram/verify`,
  secret_token: secret,
  // Only what the webhook handles; everything else never reaches the server.
  allowed_updates: ["message", "callback_query"],
  max_connections: 40,
});

await call("setMyCommands", {
  scope: { type: "all_private_chats" },
  commands: [
    { command: "start", description: "Main menu" },
    { command: "account", description: "Your linked VinnaBet account" },
    { command: "verify", description: "Link this Telegram to your VinnaBet account" },
    { command: "ticket", description: "Check a ticket" },
    { command: "help", description: "Help and support" },
    { command: "unlink", description: "Disconnect this Telegram from VinnaBet" },
  ],
});

await call("setChatMenuButton", {
  menu_button: { type: "web_app", text: "Open VinnaBet", web_app: { url: webApp } },
});

await call("setMyShortDescription", {
  short_description: "VinnaBet — sports, casino and games with your real VinnaBet wallet.",
});

await call("setMyDescription", {
  description:
    "Welcome to VinnaBet.\n\n" +
    "• Verify your phone number to link your VinnaBet account\n" +
    "• Open VinnaBet right here in Telegram — signed in automatically\n" +
    "• Check any ticket by its code",
});

const info = await call("getWebhookInfo");
console.log(`\nWebhook: ${info.url}`);
console.log(`Pending updates: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`Last error: ${info.last_error_message}`);
console.log(`Mini App: ${webApp}`);
