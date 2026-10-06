// Telegram Mini App initData validation — pure, split out so it's testable
// without a bot token in the environment (same shape as tgVerifyCore).
//
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// initData is a query string Telegram builds and signs when it opens the Mini
// App. Everything in it — above all `user.id` — is only trustworthy once the
// hash checks out against our bot token. Nothing the Mini App's JavaScript
// says about who the user is gets used anywhere else.

import { createHmac, timingSafeEqual } from "node:crypto";

/** How old a launch may be before we refuse it. initData is replayable for as
 *  long as it's accepted, so this is the window a leaked copy is worth
 *  anything; an hour comfortably covers a slow network and a user who left
 *  the app open before tapping through. Reopening the app mints a fresh one. */
export const INIT_DATA_MAX_AGE = 60 * 60;

/** A launch dated this far in the future is a clock problem or a forgery. */
const MAX_CLOCK_SKEW = 60;

/** Real initData is well under 2 KB; anything far bigger isn't Telegram's. */
const MAX_INIT_DATA_LENGTH = 8 * 1024;

export type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
};

export type InitDataResult =
  | { ok: true; user: TgUser; authDate: number; startParam: string | null }
  | { ok: false; reason: "malformed" | "bad-hash" | "expired" | "no-user" };

/**
 * Validate a Mini App initData string with the bot token that launched it.
 *
 *   secret_key       = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   data_check_string = every field except `hash`, as key=value, sorted by key,
 *                       joined with "\n"
 *   valid           ⇔ hex(HMAC_SHA256(key = secret_key, data = data_check_string)) == hash
 *
 * `signature` (Bot API 8.0, for third-party validation) stays IN the check
 * string — only `hash` is excluded.
 *
 * `now` is seconds, injected so the freshness check is testable.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  now: number = Math.floor(Date.now() / 1000),
  maxAge: number = INIT_DATA_MAX_AGE,
): InitDataResult {
  if (!botToken || typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const fields: [string, string][] = [];
  const seen = new Set<string>();
  let hash: string | null = null;
  for (const [key, value] of params) {
    // A repeated key makes "which value was signed" ambiguous — Telegram never
    // sends one, so it can only be tampering.
    if (seen.has(key)) return { ok: false, reason: "malformed" };
    seen.add(key);
    if (key === "hash") hash = value;
    else fields.push([key, value]);
  }
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "malformed" };

  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const checkString = fields.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) {
    return { ok: false, reason: "bad-hash" };
  }

  // Only past this line is anything in the payload believable.
  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: "malformed" };
  if (now - authDate > maxAge || authDate - now > MAX_CLOCK_SKEW) return { ok: false, reason: "expired" };

  let user: unknown;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isTgUser(user)) return { ok: false, reason: "no-user" };

  return { ok: true, user, authDate, startParam: params.get("start_param") };
}

function isTgUser(u: unknown): u is TgUser {
  if (!u || typeof u !== "object") return false;
  const id = (u as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

/**
 * Build a signed initData string — what Telegram does. Only for tests and the
 * local QA script; production never signs anything, it only verifies.
 */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
