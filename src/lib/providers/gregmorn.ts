import crypto from "crypto";

/**
 * Gregmorn Hub provider adapter.
 *
 * Two hosts, per the docs' naming pattern (stage adds "-dev"):
 *   office-api.gregmorn.org  — auth (JWT) + per-user game catalog
 *   client-api.gregmorn.org  — openGame session launches
 *
 * Signing: every client-api call and every wallet callback they send us uses
 * hex HMAC-SHA256 over the raw JSON body, keyed by the API sub-user's
 * secret_api_key (the "Vinnabet" sub-user under infin8 — NOT the parent
 * account; signatures are per-user_id).
 */

// Read at call time, not import time — env can change between deploy config
// and module load (and tests set it per case).
const officeUrl = () => process.env.GREGMORN_OFFICE_URL || "https://office-api.gregmorn.org";
const clientUrl = () => process.env.GREGMORN_CLIENT_URL || "https://client-api.gregmorn.org";

// API identity: the "Vinnabet" sub-user. Its secret signs launches and
// verifies their callbacks.
const userId = () => process.env.GREGMORN_USER_ID ?? "";

export function signBody(rawBody: string): string {
  return crypto
    .createHmac("sha256", process.env.GREGMORN_SECRET_KEY ?? "")
    .update(rawBody)
    .digest("hex");
}

export class GregmornError extends Error {
  status: number;
  providerMessage: string;
  constructor(status: number, providerMessage: string) {
    super(`Gregmorn ${status}: ${providerMessage}`);
    this.name = "GregmornError";
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

// ── Auth (office host) ────────────────────────────────────────────────────────
// Only needed for catalog sync — launches don't use the JWT. Tokens are
// single-session: any newer login (incl. the dashboard) supersedes them, so
// callers must re-login on 401 rather than cache long.

export async function gregmornLogin(): Promise<string> {
  const res = await fetch(`${officeUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      login: process.env.GREGMORN_LOGIN!,
      password: process.env.GREGMORN_PASSWORD!,
    }),
  });
  if (!res.ok) throw new GregmornError(res.status, await res.text());
  const data = (await res.json()) as { accessToken: string };
  return data.accessToken;
}

// ── Catalog (office host) ─────────────────────────────────────────────────────

export interface GregmornGame {
  id: string; // e.g. "black:pg:1024", "nova:sports-betby:sports"
  title: string;
  provider: string;
  imageUrl: string;
  isEnabled: boolean;
}

export async function getUserGames(
  token: string,
  currency = "ETB",
  forUserId = userId()
): Promise<GregmornGame[]> {
  const res = await fetch(`${officeUrl()}/users/${forUserId}/getUserGames/${currency}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new GregmornError(res.status, await res.text());
  return (await res.json()) as GregmornGame[];
}

// ── Launch (client host) ──────────────────────────────────────────────────────

export interface OpenGameParams {
  gameId: string;
  playerLogin: string; // our user.id — comes back as `login` in callbacks
  exitUrl: string;
  currency?: string;
  language?: string;
  demo?: boolean;
}

export interface OpenGameResult {
  url: string;
  sessionId: string;
}

/**
 * Kill-switch mirrors SILENT_API_LIVE: real openGame calls create billable
 * sessions, so they're OPT-IN via GREGMORN_LIVE="true". Otherwise return a
 * mock URL that bounces to our own placeholder route.
 *
 * GREGMORN_DEMO="true" forces demo:"1" on every real launch — play-money
 * sessions, no wallet callbacks, no billing. For staging/smoke tests against
 * the real provider.
 */
export async function openGame(params: OpenGameParams): Promise<OpenGameResult> {
  if (process.env.GREGMORN_LIVE !== "true") {
    const origin = new URL(params.exitUrl).origin;
    return {
      url: `${origin}/mock-game?game=${encodeURIComponent(params.gameId)}`,
      sessionId: `mock-${Date.now()}`,
    };
  }

  const body = JSON.stringify({
    currency: params.currency ?? "ETB",
    demo: params.demo || process.env.GREGMORN_DEMO === "true" ? "1" : "0",
    exitUrl: params.exitUrl,
    gameId: params.gameId,
    language: params.language ?? "en",
    player_login: params.playerLogin,
    user_id: userId(),
  });

  const res = await fetch(`${clientUrl()}/games/openGame`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signBody(body),
    },
    body,
  });

  const text = await res.text();
  let data: {
    status?: string;
    error?: string;
    content?: { game?: { url?: string }; gameRes?: { sessionId?: string | number } };
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new GregmornError(res.status, `non-JSON response: ${text.slice(0, 120)}`);
  }

  if (!res.ok || data.status !== "success" || !data.content?.game?.url) {
    throw new GregmornError(res.status, data.error ?? "openGame failed");
  }

  return {
    url: data.content.game.url,
    sessionId: String(data.content.gameRes?.sessionId ?? ""),
  };
}
