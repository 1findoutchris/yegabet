import "server-only";
import type { Game, Provider } from "@/types/games";
import { PROVIDER_META, OCTHERA_AVIATOR_ID, OCTHERA_ID_PREFIX } from "@/types/games";
import { listGames as listOctheraGames, gameImageUrl as octheraImageUrl } from "@/lib/providers/octhera";
import { loadCatalog, catalogGames } from "@/lib/catalog";
import { SECTION_CATEGORIES, type Section } from "@/lib/catalogClassify";
import { HIDDEN_PROVIDERS, loadLegacyFiles, legacyGameNames } from "@/lib/legacyCatalog";

export type { Game, Provider };
export { PROVIDER_META };

/*
 * Which catalog the site shows.
 *   octhera (default) — everything on our Octhera account, imported into the
 *                       database and organized into Casino / Sports / Games
 *                       (lib/catalog). The old game_list/ games are off the site.
 *   legacy            — GAME_CATALOG=legacy: the old game_list/ catalog, as
 *                       before the Octhera import. Rollback only.
 */
export const catalogMode = (): "octhera" | "legacy" =>
  process.env.GAME_CATALOG === "legacy" ? "legacy" : "octhera";

// Crash / instant-win providers
const CRASH_PROVIDERS = new Set([
  "inout",
  "spribe",
  "smartsoft",
  "turbogames-world",
  "turbogames-asia",
  "galaxsys",
  "expanse",
]);

// Live casino providers
const LIVE_PROVIDERS = new Set([
  "evolution-gaming", // Gregmorn catalog
  "evolutionlive",
  "pragmaticplaylive-eu",
  "pragmaticplaylive-asia",
  "sagaming",
  "sexy",
  "yeebet",
  "v8",
  "dreamgaming",
  "ezugi",
]);

// Octhera catalog games carry their own category; legacy ones go by provider.
const isCrash = (g: Game) => g.category ? g.category === "crash" : g.kind === "crash" || CRASH_PROVIDERS.has(g.provider);
const isLive = (g: Game) => g.category ? g.category === "live" : g.kind === "live" || LIVE_PROVIDERS.has(g.provider);

/** Site section of a game. Legacy games: crash/instant → Games, the rest → Casino. */
export const sectionOf = (g: Game): Section => g.section ?? (isCrash(g) ? "games" : "casino");
/** The section's tab a game sits in. Legacy games are inferred the same way the old lists did. */
export const categoryOf = (g: Game): string =>
  g.category ?? (isLive(g) ? "live" : isCrash(g) ? "crash" : g.customGameType === 0 ? "slots" : "table");
const isCasino = (g: Game) => sectionOf(g) === "casino";

// ── Shuffle helpers ───────────────────────────────────────────────────────────

function daySeededRng(): () => number {
  let s = Math.floor(Date.now() / 86_400_000);
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffle<T>(arr: T[]): T[] {
  const rng = daySeededRng();
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/*
 * Spribe Aviator via Octhera — appended to whichever catalog is loaded, while
 * OCTHERA_AVIATOR_PUBLIC=true and an API key is configured. Plays with the
 * normal VinnaBet balance, like every Octhera game.
 */
function octheraAviator(): Game | null {
  if (process.env.OCTHERA_AVIATOR_PUBLIC !== "true" || !process.env.OCTHERA_API_KEY) return null;
  return {
    gameID: OCTHERA_AVIATOR_ID,
    gameNameEn: "Aviator",
    // Octhera serves artwork for every game at /media/games/<gameUid>.
    img: process.env.OCTHERA_AVIATOR_IMG ||
      (process.env.OCTHERA_AVIATOR_GAME_UID
        ? `https://api.octhera.org/media/games/${process.env.OCTHERA_AVIATOR_GAME_UID}`
        : "https://ossimg.forpicstore777.top/rajalottery/gamelogo/TB_Chess/800_20250421220338955.png"),
    customGameType: 0,
    vendorCode: "SPRIBE",
    provider: "spribe",
  };
}

/*
 * Octhera's whole catalog — "octhera:<gameUid>" games, played with the
 * normal VinnaBet balance (Octhera API v2 calls /api/provider/octhera/wallet).
 * Two places show it:
 *   - /octhera: every Octhera game, for everyone, whenever an API key is set
 *     (OCTHERA_PAGE=off hides the page)
 *   - the normal lists (lobby, search, provider pages), only while
 *     OCTHERA_GAMES_PUBLIC=true
 *
 * Fetched from Octhera at runtime (not a JSON file) and refreshed hourly.
 * Pages and routes that read the catalog `await loadOctheraGames()` (or
 * `loadOctheraPage()`) first; the getters below stay synchronous and use
 * whatever was last loaded. Kept on globalThis so every route bundle shares
 * one copy.
 */
const OCTHERA_TTL_MS = 60 * 60 * 1000;
const OCTHERA_RETRY_MS = 5 * 60 * 1000;
const OCTHERA_FIRST_LOAD_WAIT_MS = 8_000;

type OctheraCatalog = {
  games: Game[]; at: number; loading: Promise<void> | null;
  loadedAt?: number; error?: string | null;
};
const octheraCatalog: OctheraCatalog = ((globalThis as { __octheraCatalog?: OctheraCatalog }).__octheraCatalog ??= {
  games: [], at: 0, loading: null,
});

const octheraGamesOn = () => process.env.OCTHERA_GAMES_PUBLIC === "true" && !!process.env.OCTHERA_API_KEY;
const octheraPageOn = () => process.env.OCTHERA_PAGE !== "off" && !!process.env.OCTHERA_API_KEY;

/** Octhera's provider → one of our slugs when it matches one (so "SPRIBE" joins /casino/spribe). */
function octheraProviderSlug(provider: string, providerName: string, known: Set<string>): string {
  const candidates = [provider, providerName].filter(Boolean).flatMap((s) => {
    const lower = s.toLowerCase();
    return [lower.replace(/[^a-z0-9]/g, ""), lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")];
  });
  return candidates.find((c) => known.has(c)) ?? candidates[candidates.length - 1] ?? "octhera";
}

async function fetchOctheraGames(): Promise<Game[]> {
  const known = new Set([...Object.keys(PROVIDER_META), ...loadLegacyFiles().map((g) => g.provider)]);
  return (await listOctheraGames()).map((g) => ({
    gameID: `${OCTHERA_ID_PREFIX}${g.gameUid}`,
    gameNameEn: g.name.trim(),
    img: g.img || octheraImageUrl(g.gameUid),
    customGameType: /slot/i.test(g.type ?? "") ? 0 : 1,
    vendorCode: g.provider || "OCTHERA",
    provider: octheraProviderSlug(g.provider ?? "", g.providerName ?? "", known),
    providerName: g.providerName || g.provider || undefined,
    kind: /crash|instant/i.test(g.type ?? "") ? "crash" : /live/i.test(g.type ?? "") ? "live" : undefined,
  }));
}

/**
 * Pages and routes await this before using the getters below.
 * octhera mode: the imported catalog (lib/catalog). legacy mode: the Octhera
 * games mixed into the old lists, only while OCTHERA_GAMES_PUBLIC is on.
 */
export async function loadGames(): Promise<void> {
  if (catalogMode() === "octhera") {
    await loadCatalog();
    _cache = null;
  } else if (octheraGamesOn()) {
    await refreshOcthera();
  }
}
/** Old name, kept for callers that predate the Octhera catalog. */
export const loadOctheraGames = loadGames;

/**
 * For /octhera and launching from it: load the catalog whenever the page is
 * on, and say what came back (the games, or why there are none).
 */
export async function loadOctheraPage(): Promise<{ on: boolean; games: Game[]; error: string | null }> {
  if (!octheraPageOn()) return { on: false, games: [], error: null };
  await refreshOcthera();
  return { on: true, games: octheraCatalog.games, error: octheraCatalog.games.length ? null : octheraCatalog.error ?? null };
}

/** Make sure the catalog is loaded (first call waits up to 8s; later ones refresh in the background). */
async function refreshOcthera(): Promise<void> {
  if (Date.now() - octheraCatalog.at < OCTHERA_TTL_MS) return;

  octheraCatalog.loading ??= fetchOctheraGames()
    .then((games) => {
      octheraCatalog.games = games;
      octheraCatalog.at = Date.now();
      octheraCatalog.loadedAt = octheraCatalog.at;
      octheraCatalog.error = null;
      _cache = null;
      console.log(`[octhera] catalog loaded: ${games.length} games`);
    })
    .catch((e) => {
      // Keep whatever we had; try again in 5 minutes.
      octheraCatalog.at = Date.now() - OCTHERA_TTL_MS + OCTHERA_RETRY_MS;
      octheraCatalog.error = e instanceof Error ? e.message : String(e);
      console.warn("[octhera] catalog load failed:", octheraCatalog.error);
    })
    .finally(() => {
      octheraCatalog.loading = null;
    });

  // Something already loaded → serve it and refresh behind the scenes.
  if (octheraCatalog.games.length) return;
  await Promise.race([
    octheraCatalog.loading,
    new Promise((r) => setTimeout(r, OCTHERA_FIRST_LOAD_WAIT_MS)),
  ]);
}

const nameKey = (g: Game) => `${g.provider}|${g.gameNameEn.trim().toLowerCase()}`;

/*
 * The sportsbook stays the original one (SportsPane on /sports, untouched).
 * Octhera's sports content is imported and classified (section "sports") but
 * not shown or launchable anywhere on the site.
 */
let _shown: { from: Game[]; games: Game[] } | null = null;
function shownCatalog(): Game[] {
  const all = catalogGames();
  if (_shown?.from !== all) _shown = { from: all, games: all.filter((g) => g.section !== "sports") };
  return _shown.games;
}

let _cache: Game[] | null = null;
function getAllGames(): Game[] {
  if (catalogMode() === "octhera") return shownCatalog();
  if (_cache) return _cache;
  const aviator = octheraAviator();
  // Disabled providers apply to the main catalog only — Octhera is its own account.
  const own = [...(aviator ? [aviator] : []), ...loadLegacyFiles()].filter((g) => !HIDDEN_PROVIDERS.has(g.provider));
  // A game we already have from the main provider stays there; Octhera only
  // adds what's missing, so no game shows up twice.
  const ownNames = new Set(own.map(nameKey));
  const octhera = octheraGamesOn()
    ? octheraCatalog.games.filter((g) => !ownNames.has(nameKey(g)))
    : [];
  const seen = new Set<string>();
  _cache = [...own, ...octhera].filter((g) => {
    if (seen.has(g.gameID)) return false;
    seen.add(g.gameID);
    return true;
  });
  return _cache;
}

// ── Public exports ────────────────────────────────────────────────────────────

// Popular crash/instant games — fixed order, shown first on Games page
const POPULAR_GAME_IDS = [
  OCTHERA_AVIATOR_ID,                 // Aviator        — Spribe via Octhera (when enabled)
  "a04d1f3eb8ccec8a4823bdf18e3f0e84", // Aviator        — Spribe
  "2e815f80a5a87b0255c130c00d95a71e", // JetX           — SmartSoft
  "66d311ff6cf531e40b61c483dd34c5c9", // Penalty Unlimited — InOut
  "562b299961b0ec40f252a832453c67b0", // Chicken Road 2.0  — InOut
  "c311eb4bbba03b105d150504931f2479", // Keno            — Spribe
  "5c4a12fb0a9b296d9b0d5f9e1cd41d65", // Mines           — Spribe
  "6ab7a4fe5161936012d6b06143918223", // Plinko          — Spribe
  "2126c5c458316ba1f2df65b387b60408", // Chicken Road    — InOut
  "af95a673c8f3a420444d73421bcf0e7a", // Hamster Run     — InOut
  "de88f202c5a8beeaccabbd944f8acfbf", // Balloon         — Spribe
  "8a87aae7a3624d284306e9c6fe1b3e9c", // Dice            — Spribe
  "458bd34bc83e34501df7e7f96626df6b", // Forest Arrow    — InOut
];

/**
 * Name search across the whole catalogue (~8,300 games), for the lobby search
 * field. Games whose name STARTS with the query come first — typing "book"
 * should surface "Book of Dead" ahead of "Wild Book Bonanza" — and within each
 * group the ones with artwork lead, since a wall of placeholder tiles reads as
 * a broken search.
 *
 * Server-side because the catalogue is 1.8 MB of JSON: shipping it to the
 * browser to filter three characters would cost more than every other asset on
 * the page combined.
 */
export function searchGames(query: string, limit = 24): Game[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const starts: Game[] = [];
  const contains: Game[] = [];
  const byProvider: Game[] = [];
  for (const g of getAllGames()) {
    const name = g.gameNameEn.toLowerCase();
    if (name.startsWith(q)) starts.push(g);
    else if (name.includes(q)) contains.push(g);
    // "pragmatic" finds Pragmatic Play's games, after any name matches.
    else if (providerLabel(g).toLowerCase().includes(q)) byProvider.push(g);
  }

  const byArtwork = (a: Game, b: Game) => Number(Boolean(b.img)) - Number(Boolean(a.img));
  return [...starts.sort(byArtwork), ...contains.sort(byArtwork), ...byProvider.sort(byArtwork)].slice(0, limit);
}

/*
 * Octhera catalog: the crash/instant games players look for first, by name.
 * A name's first match wins (Spribe's Aviator before any other "Aviator").
 */
const POPULAR_NAMES: RegExp[] = [
  /^aviator$/, /^jet ?x$/, /^spaceman$/, /^mines$/, /^plinko$/, /^chicken road/, /^penalty/,
  /^dice$/, /^keno$/, /^limbo$/, /^balloon$/, /^hi-?lo$/, /^goal$/, /^aviatrix$/, /crash/,
];

export function getPopularGames(): Game[] {
  if (catalogMode() === "octhera") {
    const crash = getAllGames().filter(isCrash);
    const out: Game[] = [];
    const taken = new Set<string>();
    for (const re of POPULAR_NAMES) {
      const matches = crash
        .filter((g) => !taken.has(g.gameID) && re.test(g.gameNameEn.trim().toLowerCase()))
        .sort((a, b) => Number(b.provider === "spribe") - Number(a.provider === "spribe"));
      // One per name for exact names; up to three for the loose patterns.
      for (const g of matches.slice(0, re.source.startsWith("^") && re.source.endsWith("$") ? 1 : 3)) {
        out.push(g);
        taken.add(g.gameID);
      }
    }
    return out.slice(0, 18);
  }
  const byId = new Map(getAllGames().map((g) => [g.gameID, g]));
  return POPULAR_GAME_IDS.flatMap((id) => {
    const g = byId.get(id);
    return g ? [g] : [];
  });
}

// Hot: non-live, non-crash — shuffled daily (prefer games that have images)
export function getHotGames(limit = 18): Game[] {
  const all = getAllGames().filter(
    (g) => isCasino(g) && !isLive(g) && !isCrash(g)
  );
  const withImg = shuffle(all.filter((g) => g.img));
  const noImg   = shuffle(all.filter((g) => !g.img));
  return [...withImg, ...noImg].slice(0, limit);
}

// New: different daily shuffle, prefer games with images
export function getNewGames(limit = 18): Game[] {
  const rng = daySeededRng();
  for (let i = 0; i < 50; i++) rng();
  const pool = getAllGames().filter(
    (g) => isCasino(g) && !isLive(g) && !isCrash(g)
  );
  const withImg = [...pool.filter((g) => g.img)];
  for (let i = withImg.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [withImg[i], withImg[j]] = [withImg[j], withImg[i]];
  }
  return withImg.slice(0, limit);
}

// Slots: customGameType 0, non-crash, non-live — shuffled daily
/**
 * SmartSoft's slot titles, in the order they head the Slots rail.
 *
 * Listed by id because nothing in the feed can derive them: SmartSoft is in
 * CRASH_PROVIDERS (most of its catalogue is JetX, PlinkoX, Balloon…) so its
 * games are excluded from slots wholesale, and all 39 of them carry
 * customGameType 0 — the same value as a real slot. Its roulette and keno
 * titles are deliberately absent too.
 *
 * Anything not listed here stays out of the rail, so a new SmartSoft slot needs
 * a line added.
 */
const SMARTSOFT_SLOT_IDS: string[] = [
  "a3168ce2162dd8abce11220bd9f21f84", // RodeoX
  "d14c7bee006243f2c871f948567cd6de", // MultiHot 5
  "d1b3c0d5a9244f091326d5b67326be29", // Multi Hot Ways
  "cab7aee3bac4f737e21064af9b15eb3e", // 4 Bonuses Bonanza
  "80d9739d8f8c28efed374f92004aeff9", // Burning Ice
  "ec484f392ab823b1eda3ae165855aa62", // Burning Ice 10
  "a45fe51120ece7b82df68db517be93ef", // Burning Ice 40
  "0c6784230fa2e9a1025b94e5f922db20", // Wild & Gods
  "70aa2b994c771293caf6e293ad558184", // Book of Futuria
  "15aaf33fa883350f2e30e6e154da983d", // WildMultiStar
  "97975f474952c6f82eca72c0dec22479", // HotSamba
  "3a849575e6d3df594ba83d3083260a6e", // Vampires
  "01339844968800b82b913fdbe84d57ab", // Genie's Bonanza
  "64baba1e8dac6b12acccb88bb945d91a", // Foxy Hot 20
  "556c49ac0e6031cd0387bd3d8dae9e5e", // Samurai
  "b093f4f7518a4929e21df64c718edb32", // Safari Simba
  "8a35c9e64d05c2556035c4a04fa9cc51", // Sugar Fiesta
  "19e72f5d7562f1129621394f6d765da7", // Dracula's Fortune
  "b04b18102cbf1e72c80a940b45adf0a9", // Book Of Bonanza
  "a938075077a7d997ea53ee0570ab4223", // Mad Slot
];

// Slots: customGameType 0, non-crash, non-live — SmartSoft's slots pinned to
// the front in listed order, everything else shuffled daily behind them.
// Feeds both the lobby rail and /casino/slots, so the pinning holds in both.
export function getSlotGames(limit = 18): Game[] {
  const featured = getGamesByIds(SMARTSOFT_SLOT_IDS).filter((g) => g.img);
  // SmartSoft is a CRASH_PROVIDER, so the shuffled pool can't duplicate these.
  const pool = getAllGames().filter(
    (g) =>
      isCasino(g) &&
      !isCrash(g) &&
      !isLive(g) &&
      categoryOf(g) === "slots"
  );
  return [...featured, ...shuffle(pool.filter((g) => g.img))].slice(0, limit);
}

// Crash: popular first, rest shuffled
export function getCrashGames(limit = 500): Game[] {
  const popular = getPopularGames();
  const popularIds = new Set(popular.map((g) => g.gameID));
  const rest = shuffle(
    getAllGames().filter(
      (g) => isCrash(g) && !popularIds.has(g.gameID)
    )
  );
  return [...popular, ...rest].slice(0, limit);
}

// Live casino: evolutionlive first, then others (prioritizing games with images)
export function getLiveCasinoGames(limit = 18): Game[] {
  const evo = getAllGames().filter(
    (g) => g.provider === "evolutionlive"
  );
  const others = getAllGames().filter(
    (g) =>
      isLive(g) &&
      g.provider !== "evolutionlive"
  );

  const evoWithImg = evo.filter((g) => g.img);
  const evoNoImg = evo.filter((g) => !g.img);
  const othersWithImg = others.filter((g) => g.img);
  const othersNoImg = others.filter((g) => !g.img);

  return [...evoWithImg, ...othersWithImg, ...evoNoImg, ...othersNoImg].slice(0, limit);
}

// Resolve an ordered list of gameIDs → Game objects (skips unknown IDs).
// Order follows the input `ids` array, so callers control sort (e.g. recency).
export function getGamesByIds(ids: string[]): Game[] {
  const byId = new Map(getAllGames().map((g) => [g.gameID, g]));
  return ids.flatMap((id) => {
    const g = byId.get(id);
    return g ? [g] : [];
  });
}

// Recommendations seeded from the providers the player actually played.
// Pulls more games from those providers (excluding `excludeIds`), then tops up
// with hot games so the rail is always full.
export function getRecommendedFrom(
  playedGameIds: string[],
  excludeIds: string[],
  limit = 18
): Game[] {
  const exclude = new Set(excludeIds);
  const played = getGamesByIds(playedGameIds);
  const providers = new Set(played.map((g) => g.provider));

  const fromProviders = shuffle(
    getAllGames().filter(
      (g) =>
        providers.has(g.provider) &&
        !exclude.has(g.gameID) &&
        g.img &&
        !isLive(g) &&
        sectionOf(g) !== "sports"
    )
  );

  const out: Game[] = [];
  const seen = new Set<string>();
  for (const g of [...fromProviders, ...getHotGames(limit * 3)]) {
    if (seen.has(g.gameID) || exclude.has(g.gameID)) continue;
    seen.add(g.gameID);
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

export function getGamesByProvider(providerSlug: string, limit = 500): Game[] {
  const games = getAllGames().filter((g) => g.provider === providerSlug);
  const withImg = games.filter((g) => g.img);
  const noImg = games.filter((g) => !g.img);
  return [...withImg, ...noImg].slice(0, limit);
}

const providerLabel = (g: Game) => PROVIDER_META[g.provider]?.name ?? g.providerName ?? g.provider;

/**
 * Providers with their game counts, for the provider filters. Optionally
 * limited to one section. Octhera's catalog lists every provider (even with
 * a single game); the legacy one hides providers with fewer than five.
 */
export function getProviderStats(section?: Section): { slug: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const g of getAllGames()) {
    if (section && sectionOf(g) !== section) continue;
    counts.set(g.provider, (counts.get(g.provider) ?? 0) + 1);
    if (!names.has(g.provider)) names.set(g.provider, providerLabel(g));
  }
  const min = catalogMode() === "octhera" ? 1 : 5;
  return Array.from(counts.entries())
    .map(([slug, count]) => ({ slug, name: names.get(slug) ?? slug, count }))
    .filter((p) => p.count >= min)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Every game in a section (optionally one category), games with artwork first. */
export function getSectionGames(section: Section, category?: string): Game[] {
  const order = SECTION_CATEGORIES[section].map((c) => c.id as string);
  const rank = (g: Game) => order.indexOf(categoryOf(g));
  const games = getAllGames()
    .filter((g) => sectionOf(g) === section && (!category || categoryOf(g) === category))
    // Tab order (e.g. sportsbook before virtual sports); stable within a tab.
    .sort((a, b) => rank(a) - rank(b));
  return [...games.filter((g) => g.img), ...games.filter((g) => !g.img)];
}

/** A section's tabs that have games, in display order, with counts. */
export function getSectionCategories(section: Section): { id: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const g of getAllGames()) {
    if (sectionOf(g) === section) counts.set(categoryOf(g), (counts.get(categoryOf(g)) ?? 0) + 1);
  }
  return SECTION_CATEGORIES[section]
    .map((c) => ({ id: c.id as string, label: c.label, count: counts.get(c.id) ?? 0 }))
    .filter((c) => c.count > 0);
}

// Lobby category tile counts — computed once over the in-memory game set.
export function getCategoryCounts(): {
  all: number; slots: number; live: number; crash: number; new: number; hot: number; table: number;
} {
  const all = getAllGames();
  let slots = 0, live = 0, crash = 0, lobby = 0, table = 0;
  for (const g of all) {
    if (isLive(g)) { live++; continue; }
    if (isCrash(g)) { crash++; continue; }
    if (!isCasino(g)) continue;
    lobby++;
    const cat = categoryOf(g);
    if (cat === "slots" && g.img) slots++;
    if (cat === "table" && g.category) table++;
  }
  return { all: all.length, slots, live, crash, new: lobby, hot: lobby, table };
}

/**
 * Display names for games in history (tickets, bets): the catalog first, then
 * the old catalog, so bets on games no longer offered keep their names.
 */
export function getGameNamesForHistory(ids: string[]): Map<string, string> {
  const out = new Map(getGamesByIds(ids).map((g) => [g.gameID, g.gameNameEn]));
  const missing = ids.filter((id) => !out.has(id));
  for (const [id, name] of legacyGameNames(missing)) out.set(id, name);
  return out;
}
