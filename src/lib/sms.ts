import { prisma } from "./prisma";

const DEFAULT_SMSGATE_URL = "https://api.sms-gate.app/3rdparty/v1/messages";
const DEFAULT_AFRO_URL = "https://api.afromessage.com/api/send";

/**
 * Somewhere a message can be handed to. Two providers, kept in one pool so the
 * rotation, the failover and the admin kill switch are written once:
 *
 *   smsgate — a handset in the office running SMS Gate. Free, and as reliable
 *             as that phone's signal and charge.
 *   afro    — AfroMessage, a real carrier. Costs money per message, which is
 *             why sendSms only reaches for it once the handsets have failed.
 *
 * A union rather than optional fields: there is no such thing as a gateway with
 * both a password and a bearer token, and the compiler should say so.
 */
export type SmsGateway =
  | {
      kind: "smsgate";
      /** For logs only, so a failing phone can be identified without leaking creds. */
      label: string;
      user: string;
      pass: string;
      url: string;
    }
  | {
      kind: "afro";
      label: string;
      token: string;
      /** Approved sender name. Omitted → AfroMessage uses the account default. */
      sender?: string;
      /** Their "identifier ID" for that sender, from the AfroMessage dashboard. */
      from?: string;
      url: string;
    };

/**
 * Every configured handset, in env order:
 *
 *   SMSGATE_USERNAME   / SMSGATE_PASSWORD   [/ SMSGATE_URL]     → phone 1
 *   SMSGATE_USERNAME_2 / SMSGATE_PASSWORD_2 [/ SMSGATE_URL_2]   → phone 2
 *   …up to _5
 *
 * A pair missing half its credentials is skipped rather than half-configured:
 * a typo in one variable would otherwise send every message to a phone that
 * always 401s. Takes `env` so sms.check.ts can exercise it.
 *
 * AfroMessage, if AFROMESSAGE_API_KEY is set, is appended as one more gateway
 * with the label "afro" — so it shows up in the admin panel and obeys the same
 * switch. Its position in the list is not its position in the try order; see
 * tryOrder.
 */
export function smsGateways(env: NodeJS.ProcessEnv = process.env): SmsGateway[] {
  const out: SmsGateway[] = [];
  for (const suffix of ["", "_2", "_3", "_4", "_5"]) {
    const user = env[`SMSGATE_USERNAME${suffix}`];
    const pass = env[`SMSGATE_PASSWORD${suffix}`];
    if (!user || !pass) continue;
    out.push({
      kind: "smsgate",
      label: suffix === "" ? "1" : suffix.slice(1),
      user,
      pass,
      // Falls back to the shared URL, so a second phone on the same cloud needs
      // only its own credentials.
      url: env[`SMSGATE_URL${suffix}`] ?? env.SMSGATE_URL ?? DEFAULT_SMSGATE_URL,
    });
  }

  // Only the key is required: sender/identifier are optional on AfroMessage's
  // side, and half-configuring those degrades the sender name rather than
  // breaking delivery — unlike a handset missing its password.
  const token = env.AFROMESSAGE_API_KEY;
  if (token) {
    out.push({
      kind: "afro",
      label: "afro",
      token,
      sender: env.AFROMESSAGE_SENDER || undefined,
      from: env.AFROMESSAGE_FROM || undefined,
      url: env.AFROMESSAGE_URL ?? DEFAULT_AFRO_URL,
    });
  }
  return out;
}

/**
 * The order one send actually walks: handsets first in rotation, the paid
 * carrier only after every free phone has failed.
 *
 * Keeping AfroMessage out of the rotation is the whole cost argument — in the
 * pool it would carry 1/N of all traffic while the handsets sit idle; behind
 * it, it bills only for messages that would otherwise have been lost. Disable
 * every handset in the admin panel and it becomes the only gateway left, which
 * is the manual override.
 */
export function tryOrder(gateways: SmsGateway[], start: number): SmsGateway[] {
  const handsets = gateways.filter((gw) => gw.kind === "smsgate");
  const carriers = gateways.filter((gw) => gw.kind === "afro");
  return [...rotated(handsets, start), ...carriers];
}

/** Gateways minus the ones an admin has switched off in the panel. Pure, so
 *  sms.check.ts can prove a disabled phone is never in the try order. */
export function enabledOnly(gateways: SmsGateway[], disabled: Set<string>): SmsGateway[] {
  return gateways.filter((gw) => !disabled.has(gw.label));
}

/**
 * Labels an admin has switched off. Absent row = enabled (see SmsDevice), so
 * only explicit `false` rows count.
 *
 * A DB failure disables nothing: OTP is the registration path, and losing it
 * because a config read blipped is far worse than briefly using a phone
 * someone meant to pause.
 */
export async function disabledLabels(): Promise<Set<string>> {
  try {
    const rows = await prisma.smsDevice.findMany({
      where: { enabled: false },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    console.error("[sms] could not read device switches — treating all as enabled", err);
    return new Set();
  }
}

/** Every configured handset with its current switch, for the admin panel. */
export async function listSmsDevices(): Promise<
  { label: string; kind: SmsGateway["kind"]; user: string; url: string; enabled: boolean }[]
> {
  const disabled = await disabledLabels();
  return smsGateways().map((gw) => ({
    label: gw.label,
    kind: gw.kind,
    user:
      gw.kind === "afro"
        ? // The sender name is public — it's what recipients see — so there is
          // nothing to mask. Never the token.
          gw.sender ?? "account default sender"
        : // Enough to tell two handsets apart, not enough to reuse the account.
          gw.user.slice(0, 2) + "•".repeat(Math.max(gw.user.length - 2, 3)),
    url: gw.url,
    enabled: !disabled.has(gw.label),
  }));
}

/** Flip one handset. Upserts because the "on" state is normally no row at all. */
export async function setSmsDevice(label: string, enabled: boolean): Promise<void> {
  await prisma.smsDevice.upsert({
    where: { id: label },
    create: { id: label, enabled },
    update: { enabled },
  });
}

/** `items` reordered to start at `start`, wrapping — the try order for one
 *  send, so every gateway is attempted exactly once. */
export function rotated<T>(items: T[], start: number): T[] {
  if (items.length === 0) return [];
  const from = ((start % items.length) + items.length) % items.length;
  return items.map((_, i) => items[(from + i) % items.length]);
}

/**
 * Normalize an Ethiopian mobile number to E.164 (+2519xxxxxxxx / +2517xxxxxxxx).
 * Accepts 09xxxxxxxx, 9xxxxxxxx, 2519xxxxxxxx, +2519xxxxxxxx (and 7-prefixed).
 * Returns null for anything that isn't a valid Ethiopian mobile — the caller
 * uses null to mean "not Ethiopian, skip OTP".
 */
/**
 * Was this number aimed at Ethiopia?
 *
 * Exists to separate "foreign number, no OTP rail" from "Ethiopian number typed
 * wrong". Both fail normalizePhone, but only the first may legitimately skip
 * OTP — treating the second as foreign silently bypasses verification, which is
 * exactly the hole a leading 0 (`0912…` → `+251091234567`) used to open.
 *
 * Matches on the 251 country code only, so a `+9715…` is correctly foreign
 * despite also starting with a 9.
 */
export function isEthiopianAttempt(raw: string): boolean {
  return raw.replace(/\D/g, "").startsWith("251");
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  // 09xxxxxxxx / 07xxxxxxxx (10 digits, leading 0)
  if (/^0[79]\d{8}$/.test(digits)) return "+251" + digits.slice(1);
  // 9xxxxxxxx / 7xxxxxxxx (9 digits, no leading 0)
  if (/^[79]\d{8}$/.test(digits)) return "+251" + digits;
  // 2519xxxxxxxx / 2517xxxxxxxx (with country code)
  if (/^251[79]\d{8}$/.test(digits)) return "+" + digits;
  return null;
}

/** How long one handset gets before it's treated as dead and the next is
 *  tried. A phone that has lost signal tends to hang rather than refuse, and
 *  a registration must not sit on it. */
const SEND_TIMEOUT_MS = 10_000;

/** URL and request one provider wants for this message. Split out so the
 *  timeout, the logging and the failure handling below stay written once. */
function sendRequest(gw: SmsGateway, e164: string, text: string): [string, RequestInit] {
  if (gw.kind === "afro") {
    // GET with query params, not a JSON body: that is what AfroMessage's own Go
    // library and the published JS adapter both do. `template=0` marks the text
    // as literal rather than one of their saved templates.
    const params = new URLSearchParams({ to: e164, message: text, template: "0" });
    // Sent only when configured — an empty sender is rejected rather than
    // falling back to the account default.
    if (gw.sender) params.set("sender", gw.sender);
    if (gw.from) params.set("from", gw.from);
    return [
      `${gw.url}?${params}`,
      {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${gw.token}` },
      },
    ];
  }
  return [
    gw.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${gw.user}:${gw.pass}`).toString("base64"),
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [e164],
      }),
    },
  ];
}

/** One attempt through one gateway. Returns false on any non-2xx, timeout or
 *  network error, so the caller can move to the next. */
async function sendVia(gw: SmsGateway, e164: string, text: string): Promise<boolean> {
  try {
    const [url, init] = sendRequest(gw, e164, text);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[sms] gateway ${gw.label} failed`, res.status, await res.text().catch(() => ""));
      return false;
    }
    // AfroMessage answers 200 for a rejected number, an unapproved sender or an
    // empty balance, and puts the failure in the body. Trusting the status code
    // alone would report a code nobody received as sent — and the user would sit
    // on the verify screen with nothing to type.
    if (gw.kind === "afro") {
      const body = (await res.json().catch(() => null)) as
        | { acknowledge?: string; response?: { errors?: string[] } }
        | null;
      if (body?.acknowledge !== "success") {
        console.error(`[sms] gateway ${gw.label} rejected`, body?.response?.errors ?? body);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error(`[sms] gateway ${gw.label} error`, err);
    return false;
  }
}

/**
 * Send an SMS, spreading load across every configured handset and falling
 * through to the next when one fails — then to AfroMessage if they all did.
 *
 * Returns false only once ALL of them have failed; the caller surfaces that.
 * With a single handset configured this behaves exactly as it did before.
 */
export async function sendSms(e164: string, text: string): Promise<boolean> {
  const configured = smsGateways();
  if (configured.length === 0) {
    console.error("[sms] no gateway configured — set SMSGATE_USERNAME/PASSWORD or AFROMESSAGE_API_KEY");
    return false;
  }

  // Filtered here rather than at the call sites: one guard covers every current
  // and future caller of sendSms.
  const gateways = enabledOnly(configured, await disabledLabels());
  if (gateways.length === 0) {
    console.error(`[sms] all ${configured.length} handset(s) switched off in admin — nothing to send through`);
    return false;
  }

  // ponytail: random start rather than a shared round-robin counter. The app
  // runs on more than one instance, so a module-level counter would only
  // balance within its own process while still pinning every cold start to
  // phone 1. Random needs no shared state and evens out over volume; swap for
  // a Redis INCR if the split ever has to be exact.
  for (const gw of tryOrder(gateways, Math.floor(Math.random() * gateways.length))) {
    if (await sendVia(gw, e164, text)) return true;
  }

  console.error(`[sms] all ${gateways.length} gateway(s) failed for ${e164}`);
  return false;
}
