import "server-only";
import crypto from "crypto";

/**
 * Octhera aggregator — API v2, "company wallet" mode.
 *
 * Players play with their normal VinnaBet balance: Octhera launches the game,
 * then calls our Wallet URL (/api/provider/octhera/wallet) to authorize every
 * bet (debit) and pay every win/refund (credit). Our database is the source
 * of truth; Octhera only keeps the last reported balance for display.
 *
 * API calls: `Authorization: Bearer OCTHERA_API_KEY`.
 * Wallet calls Octhera makes to us: `X-Octhera-Signature: v1=<hex>` =
 * HMAC-SHA256(OCTHERA_WALLET_SECRET, timestamp + "." + raw body).
 *
 * Env (Railway → Variables):
 *   OCTHERA_API_KEY          — company-wallet account's API key
 *   OCTHERA_WALLET_SECRET    — wallet signing secret (API keys page)
 *   OCTHERA_BASE_URL         — optional, default https://api.octhera.org/api/v2
 *   OCTHERA_AVIATOR_GAME_UID — optional; else looked up via GET /games?q=Aviator
 *
 * The site's catalog is imported from GET /games (lib/catalog). With
 * GAME_CATALOG=legacy only (the rollback to the old game_list/ catalog):
 *   OCTHERA_AVIATOR_PUBLIC   — "true" = Aviator tile first in Popular Games
 *   OCTHERA_GAMES_PUBLIC     — "true" = Octhera's catalog in the normal lists (lib/games)
 *   OCTHERA_PAGE             — "off" hides /octhera
 */

const baseUrl = () => (process.env.OCTHERA_BASE_URL || "https://api.octhera.org/api/v2").replace(/\/+$/, "");

export class OctheraError extends Error {
  status: number;
  providerMessage: string;
  constructor(status: number, providerMessage: string) {
    super(`Octhera ${status}: ${providerMessage}`);
    this.name = "OctheraError";
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const key = process.env.OCTHERA_API_KEY;
  if (!key) throw new OctheraError(500, "OCTHERA_API_KEY is not set");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: { status?: string; message?: string } & Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new OctheraError(res.status, `non-JSON response: ${text.slice(0, 120)}`);
  }
  if (!res.ok || data.status === "fail" || data.status === "error") {
    throw new OctheraError(res.status, typeof data.message === "string" ? data.message : `HTTP ${res.status}`);
  }
  return data as T;
}

// ── Games ─────────────────────────────────────────────────────────────────────

export interface OctheraGame {
  gameUid: string;
  name: string;
  provider: string;
  providerName: string;
  type: string;
  img?: string;
  hasArtwork?: boolean;
}

/** Fallback artwork URL when a game comes without `img`. */
export function gameImageUrl(gameUid: string): string {
  return `${new URL(baseUrl()).origin}/media/games/${encodeURIComponent(gameUid)}`;
}

export interface OctheraCatalogFetch {
  games: OctheraGame[];
  pages: number;
  /** Octhera's `total`, when it sends one. */
  total: number | null;
  /** Every page came back and (when sent) `total` was reached. */
  complete: boolean;
  /** Why the fetch stopped early, when it did. */
  error: string | null;
}

/**
 * Every game on our Octhera account: GET /games?page=N&limit=200 (v2: pages
 * start at 1, limit is capped at 200, the reply carries `total`), until
 * `total` is reached or a page comes back short. Duplicate gameUids across
 * pages are dropped. Only page 1 failing throws — a refused later page keeps
 * what we already have and reports the fetch as incomplete.
 */
export async function fetchCatalog(): Promise<OctheraCatalogFetch> {
  const LIMIT = 200;
  const byUid = new Map<string, OctheraGame>();
  let total: number | null = null;
  let pages = 0;
  let error: string | null = null;
  let shortPage = false;
  for (let page = 1; page <= 200; page++) {
    let d: { games?: OctheraGame[]; total?: number };
    try {
      d = await call("GET", `/games?page=${page}&limit=${LIMIT}`);
    } catch (e) {
      if (page === 1) throw e;
      error = e instanceof Error ? e.message : String(e);
      console.warn(`[octhera] games page ${page} refused, keeping ${byUid.size} games:`, error);
      break;
    }
    pages = page;
    if (typeof d.total === "number") total = d.total;
    const games = Array.isArray(d.games) ? d.games : [];
    let added = 0;
    for (const g of games) {
      if (!g?.gameUid || !g.name || byUid.has(g.gameUid)) continue;
      byUid.set(g.gameUid, g);
      added++;
    }
    if (games.length < LIMIT) { shortPage = true; break; }
    if (added === 0) { error = `page ${page} repeated earlier games`; break; }
    if (total !== null && byUid.size >= total) break;
  }
  const reachedEnd = total !== null ? byUid.size >= total : shortPage;
  if (!error && !reachedEnd) error = total !== null ? `got ${byUid.size} of ${total} games` : "stopped before the last page";
  return { games: [...byUid.values()], pages, total, complete: !error && reachedEnd, error };
}

/** Every game on our Octhera account (see fetchCatalog). */
export async function listGames(): Promise<OctheraGame[]> {
  return (await fetchCatalog()).games;
}

let aviatorCache: { uid: string; at: number } | null = null;

/** Spribe's Aviator gameUid — env override, else searched once an hour. */
export async function aviatorGameUid(): Promise<string> {
  if (process.env.OCTHERA_AVIATOR_GAME_UID) return process.env.OCTHERA_AVIATOR_GAME_UID;
  if (aviatorCache && Date.now() - aviatorCache.at < 3_600_000) return aviatorCache.uid;

  const d = await call<{ games: OctheraGame[] }>("GET", "/games?q=Aviator&limit=50");
  const isSpribe = (g: OctheraGame) => /spribe/i.test(`${g.provider} ${g.providerName}`);
  const game =
    d.games.find((g) => isSpribe(g) && g.name.trim().toLowerCase() === "aviator") ??
    d.games.find((g) => isSpribe(g) && /aviator/i.test(g.name));
  if (!game) throw new OctheraError(404, "Spribe Aviator is not in your Octhera game list");
  aviatorCache = { uid: game.gameUid, at: Date.now() };
  return game.gameUid;
}

// ── Launch ────────────────────────────────────────────────────────────────────

/**
 * POST /players/launch → single-use launch URL, to open within 60 s. The site
 * loads it in an iframe on /game/[id]; that only works while Octhera's game
 * pages allow vinna.bet to frame them (no X-Frame-Options: DENY/SAMEORIGIN, and
 * a CSP frame-ancestors that includes the site). The first launch creates the Octhera player
 * from `playerId`, which must never change: we use the VinnaBet user id, and
 * the wallet calls send it back.
 */
export async function launchGame(params: {
  playerId: string;
  balance: number;
  gameUid: string;
  device: "mobile" | "desktop";
}): Promise<string> {
  const d = await call<{ launchUrl?: string }>("POST", "/players/launch", {
    playerId: params.playerId,
    balance: Math.max(0, Math.round(params.balance * 100) / 100),
    gameUid: params.gameUid,
    lang: "en",
    device: params.device,
  });
  if (!d.launchUrl) throw new OctheraError(502, "no launchUrl in response");
  return d.launchUrl;
}

// ── Wallet signature ──────────────────────────────────────────────────────────

/** Max clock skew Octhera allows on a wallet call's timestamp. */
export const WALLET_MAX_SKEW_S = 300;

/**
 * Verify a wallet call: X-Octhera-Timestamp within 300 s of now, and any of
 * the comma-separated `v1=<hex>` values in X-Octhera-Signature matching
 * HMAC-SHA256(secret, timestamp + "." + raw body). Two signatures arrive
 * during a secret rotation; either may match.
 */
export function verifyWalletSignature(
  rawBody: string,
  timestamp: string,
  signatureHeader: string,
  nowS = Math.floor(Date.now() / 1000)
): boolean {
  const secret = process.env.OCTHERA_WALLET_SECRET;
  if (!secret || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowS - Number(timestamp)) > WALLET_MAX_SKEW_S) return false;

  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  );
  return signatureHeader
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1="))
    .some((s) => {
      const got = Buffer.from(s.slice(3).toLowerCase());
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    });
}
