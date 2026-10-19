import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram vouches for who the user is by signing the data with our bot
 * token. We check that signature on the server (CLAUDE.md §5.5): the browser
 * or Mini App is never trusted for identity.
 */

export interface TelegramIdentity {
  id: string;
  firstName?: string;
  username?: string;
  authDate: number;
}

/** Login data older than this is refused (plan 04 §7: replayed / old initData). */
export const MAX_AUTH_AGE_S = 24 * 60 * 60;

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** "key=value" lines of every field except `hash`, sorted by key (Telegram's data-check-string). */
function dataCheckString(fields: Map<string, string>): string {
  return [...fields.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function fresh(authDate: number, nowS: number): boolean {
  return (
    Number.isInteger(authDate) && authDate > 0 && nowS - authDate <= MAX_AUTH_AGE_S && authDate - nowS <= 60
  );
}

/**
 * Mini App `initData` (a query string). Key = HMAC-SHA256("WebAppData", botToken);
 * hash = hex HMAC-SHA256(key, data-check-string).
 * Returns the user, or null if the signature, freshness or shape is wrong.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowS = Math.floor(Date.now() / 1000),
): TelegramIdentity | null {
  if (typeof initData !== "string" || initData.length > 4096) return null;
  const fields = new Map(new URLSearchParams(initData));
  const hash = fields.get("hash");
  if (!hash) return null;

  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", key).update(dataCheckString(fields)).digest("hex");
  if (!safeEqualHex(hash, expected)) return null;

  const authDate = Number(fields.get("auth_date"));
  if (!fresh(authDate, nowS)) return null;
  let user: { id?: unknown; first_name?: string; username?: string };
  try {
    user = JSON.parse(fields.get("user") ?? "null") ?? {};
  } catch {
    return null;
  }
  if (typeof user.id !== "number" && typeof user.id !== "string") return null;
  return { id: String(user.id), firstName: user.first_name, username: user.username, authDate };
}

/**
 * Website Login Widget fields. Key = SHA-256(botToken);
 * hash = hex HMAC-SHA256(key, data-check-string).
 */
export function verifyLoginWidget(
  data: Record<string, unknown>,
  botToken: string,
  nowS = Math.floor(Date.now() / 1000),
): TelegramIdentity | null {
  if (!data || typeof data !== "object") return null;
  const fields = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (k === "as") continue; // ours, not Telegram's
    if (typeof v !== "string" && typeof v !== "number") return null;
    fields.set(k, String(v));
  }
  const hash = fields.get("hash");
  if (!hash) return null;

  const key = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", key).update(dataCheckString(fields)).digest("hex");
  if (!safeEqualHex(hash, expected)) return null;

  const authDate = Number(fields.get("auth_date"));
  const id = fields.get("id");
  if (!fresh(authDate, nowS) || !id || !/^\d+$/.test(id)) return null;
  return { id, firstName: fields.get("first_name"), username: fields.get("username"), authDate };
}
