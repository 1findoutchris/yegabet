/**
 * Point the bot at this service (plan 04 §10). Run once in the Railway
 * console after setting the TELEGRAM_* variables; safe to re-run.
 *   npm run telegram:setup
 *
 * Uses Railway's RAILWAY_PUBLIC_DOMAIN (or PUBLIC_API_URL) for the webhook
 * address, so the bot token never has to be typed anywhere else.
 */
async function api(token: string, method: string, body: object): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base =
    process.env.PUBLIC_API_URL ??
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  if (!token || !secret || !base) {
    console.error(
      "Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and RAILWAY_PUBLIC_DOMAIN or PUBLIC_API_URL.",
    );
    process.exitCode = 1;
    return;
  }
  const url = `${base.replace(/\/+$/, "")}/telegram/webhook`;
  await api(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await api(token, "setMyCommands", { commands: [{ command: "start", description: "Create your account" }] });
  const me = (await api(token, "getMe", {})) as { username: string };
  const info = (await api(token, "getWebhookInfo", {})) as { url: string; pending_update_count: number };
  console.log(`@${me.username} → ${info.url} (pending updates: ${info.pending_update_count})`);
  if (process.env.TELEGRAM_BOT_USERNAME !== me.username) {
    console.warn(
      `TELEGRAM_BOT_USERNAME should be "${me.username}" (it is "${process.env.TELEGRAM_BOT_USERNAME}").`,
    );
  }
}

void main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
