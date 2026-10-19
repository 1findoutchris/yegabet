import { createHash, createHmac } from "node:crypto";

/** Test-only bot token. Signatures below are computed exactly as Telegram does. */
export const BOT_TOKEN = "123456:TEST-token-for-unit-tests-only";
export const BOT_USERNAME = "TestYegaBot";
export const WEBHOOK_SECRET = "test-webhook-secret-0123456789";

const dcs = (fields: Record<string, string>) =>
  Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

const now = () => Math.floor(Date.now() / 1000);

/** A Mini App initData string signed with `token`. */
export function signInitData(
  user: { id: number | string; first_name?: string },
  opts: { token?: string; authDate?: number; extra?: Record<string, string>; omit?: string[] } = {},
): string {
  const fields: Record<string, string> = {
    auth_date: String(opts.authDate ?? now()),
    query_id: "AAEtest",
    user: JSON.stringify({ first_name: "Test", ...user }),
    ...opts.extra,
  };
  for (const k of opts.omit ?? []) delete fields[k];
  const key = createHmac("sha256", "WebAppData")
    .update(opts.token ?? BOT_TOKEN)
    .digest();
  const hash = createHmac("sha256", key).update(dcs(fields)).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Login Widget fields signed with `token`. */
export function signWidget(
  id: number | string,
  opts: { token?: string; authDate?: number; extra?: Record<string, string> } = {},
): Record<string, string> {
  const fields: Record<string, string> = {
    id: String(id),
    first_name: "Test",
    auth_date: String(opts.authDate ?? now()),
    ...opts.extra,
  };
  const key = createHash("sha256")
    .update(opts.token ?? BOT_TOKEN)
    .digest();
  return { ...fields, hash: createHmac("sha256", key).update(dcs(fields)).digest("hex") };
}
