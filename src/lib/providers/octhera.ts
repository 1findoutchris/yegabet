import "server-only";
import crypto from "crypto";

/**
 * Octhera aggregator — TEST integration (Spribe Aviator only, behind
 * /octhera-test). Built from the company portal docs (octhera.org/portal/docs).
 *
 * Octhera RUNS THE WALLET: each player has a balance on Octhera, funded in
 * their portal (Players → player → Deposit). Launching a game plays against
 * that balance, and Octhera sends a signed webhook for every bet / win /
 * refund / withdrawal step as a record. Nothing here touches User.balance.
 *
 * Auth: `Authorization: Bearer OCTHERA_API_KEY` on every call.
 * Webhooks: `x-octhera-signature: sha256=<hex HMAC-SHA256(raw body)>` keyed
 * with OCTHERA_CALLBACK_SECRET.
 *
 * Env (Railway → Variables):
 *   OCTHERA_API_KEY          — API keys page
 *   OCTHERA_CALLBACK_SECRET  — API keys page
 *   OCTHERA_TEST_USERS       — comma-separated VinnaBet phones/usernames allowed
 *                              on /octhera-test; unset = nobody (the off switch)
 *   OCTHERA_BASE_URL         — optional, default https://api.octhera.org/api/v1
 *   OCTHERA_AVIATOR_GAME_UID — optional; else looked up via GET /games?q=Aviator
 *   OCTHERA_GAMES_PUBLIC     — "true" = Octhera's whole catalog on the site (lib/games)
 */

const baseUrl = () => (process.env.OCTHERA_BASE_URL || "https://api.octhera.org/api/v1").replace(/\/+$/, "");

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
  if (!res.ok || data.status === "fail") {
    throw new OctheraError(res.status, typeof data.message === "string" ? data.message : `HTTP ${res.status}`);
  }
  return data as T;
}

// ── Players ───────────────────────────────────────────────────────────────────

/**
 * Our Octhera player id for a VinnaBet user. Octhera wants 6–34 letters,
 * numbers or underscore; user ids are cuids (25 lowercase alphanumerics), so
 * "vb_" + id fits and maps back to exactly one user.
 */
export function octheraUsername(userId: string): string {
  return `vb_${userId.replace(/[^A-Za-z0-9_]/g, "")}`.slice(0, 34);
}

/** Register once; "already registered" (409) counts as success. */
export async function ensurePlayer(username: string): Promise<void> {
  try {
    await call("POST", "/players/register", { username });
  } catch (e) {
    if (e instanceof OctheraError && e.status === 409) return;
    throw e;
  }
}

export async function getBalance(username: string): Promise<{ balance: number; currency: string }> {
  const d = await call<{ balance: number; currency: string }>("GET", `/players/${encodeURIComponent(username)}/balance`);
  return { balance: Number(d.balance), currency: d.currency };
}

// ── Games ─────────────────────────────────────────────────────────────────────

export interface OctheraGame {
  gameUid: string;
  name: string;
  provider: string;
  providerName: string;
  type: string;
  image?: string;
  imageUrl?: string;
  enabled?: boolean;
  isEnabled?: boolean;
}

/** Octhera serves artwork for every game at /media/games/<gameUid>. */
export function gameImageUrl(gameUid: string): string {
  return `${new URL(baseUrl()).origin}/media/games/${encodeURIComponent(gameUid)}`;
}

/**
 * Every game on our Octhera account. The portal docs only show `q` and
 * `limit`, so paging is defensive: ask page 2, 3, … (also sending `offset`)
 * and stop at an empty page, a page with nothing new (pagination ignored), or
 * whatever end marker the response carries (`hasMore` / `totalPages` / `total`).
 *
 * 50 per page — the size the Aviator lookup has always used, so we know
 * Octhera accepts it. Only page 1 failing is an error: if Octhera refuses a
 * later page (say, it rejects `page`/`offset`), we keep what we already have.
 */
export async function listGames(): Promise<OctheraGame[]> {
  const LIMIT = 50;
  const seen = new Set<string>();
  const enabled: OctheraGame[] = [];
  for (let page = 1; page <= 400; page++) {
    const qs = page === 1 ? `limit=${LIMIT}` : `limit=${LIMIT}&page=${page}&offset=${(page - 1) * LIMIT}`;
    type Page = {
      games?: OctheraGame[]; hasMore?: boolean; totalPages?: number; total?: number;
      pagination?: { hasMore?: boolean; totalPages?: number; total?: number };
    };
    let d: Page;
    try {
      d = await call<Page>("GET", `/games?${qs}`);
    } catch (e) {
      if (page === 1) throw e;
      console.warn(`[octhera] games page ${page} refused, keeping ${enabled.length} games:`, e instanceof Error ? e.message : e);
      break;
    }
    const games = Array.isArray(d.games) ? d.games : [];
    let added = 0;
    for (const g of games) {
      if (!g?.gameUid || !g.name || seen.has(g.gameUid)) continue;
      seen.add(g.gameUid);
      added++;
      if (g.enabled === false || g.isEnabled === false) continue;
      enabled.push(g);
    }
    const p = { ...d, ...d.pagination };
    if (added === 0 || p.hasMore === false) break;
    if (p.totalPages !== undefined && page >= p.totalPages) break;
    if (p.total !== undefined && seen.size >= p.total) break;
  }
  return enabled;
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

/** One-time launch URL (open in an iframe or new tab). */
export async function launchGame(params: {
  username: string;
  gameUid: string;
  device: "mobile" | "desktop";
}): Promise<string> {
  const d = await call<{ launchUrl: string }>("POST", "/players/login", {
    username: params.username,
    gameUid: params.gameUid,
    lang: "en",
    device: params.device,
  });
  return d.launchUrl;
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

/** Timing-safe check of `x-octhera-signature` against the raw body. */
export function verifyWebhookSignature(rawBody: string, header: string): boolean {
  const secret = process.env.OCTHERA_CALLBACK_SECRET;
  if (!secret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Test access ───────────────────────────────────────────────────────────────

/** Is this VinnaBet account on OCTHERA_TEST_USERS? Unset/empty = nobody. */
export function isOctheraTester(user: { phone?: string | null; username?: string | null }): boolean {
  const list = (process.env.OCTHERA_TEST_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return [user.phone, user.username].some((v) => !!v && list.includes(v.toLowerCase()));
}
