import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchCatalog, gameImageUrl, type OctheraGame } from "@/lib/providers/octhera";
import { classify, slugify, type Category, type Section } from "@/lib/catalogClassify";
import { OCTHERA_ID_PREFIX, PROVIDER_META, type Game } from "@/types/games";

/*
 * The site's game catalog: everything on our Octhera account, imported into
 * `catalog_games` and organized into sections (Casino / Sports / Games).
 *
 * Import (syncCatalog):
 *   - pages through Octhera's GET /games (providers/octhera.fetchCatalog)
 *   - one row per gameUid — re-imports update in place, never duplicate
 *   - a game that's gone from Octhera is deactivated (not deleted), but only
 *     after a COMPLETE fetch: a partial one never takes games off the site
 *   - the first import also backs up the old game_list/ catalog
 *     (lib/legacyCatalog.backupLegacyCatalog)
 *
 * It runs on its own: the first page load with an empty catalog waits for it
 * (up to 8 s), and after that the site re-imports in the background once the
 * last import is an hour old. POST /api/cron/catalog-sync forces one.
 *
 * Reading (loadCatalog → catalogGames): active rows, cached in memory for a
 * minute on globalThis so every route bundle shares one copy. Octhera being
 * down never empties the site — the last import stays in the database.
 */

const SOURCE = "octhera";
const SYNC_EVERY_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 5 * 60 * 1000;
const READ_TTL_MS = 60 * 1000;
const FIRST_LOAD_WAIT_MS = 8_000;

export interface CatalogGameRow {
  id: string;
  name: string;
  providerCode: string;
  providerName: string;
  providerSlug: string;
  rawType: string;
  section: string;
  category: string;
  img: string;
}

type State = {
  games: Game[];
  readAt: number;
  reading: Promise<void> | null;
  syncing: Promise<SyncResult> | null;
  lastSyncTry: number;
  /** Don't ask the database whether an import is due before this time. */
  nextDueCheck: number;
};
const state: State = ((globalThis as { __catalog?: State }).__catalog ??= {
  games: [], readAt: 0, reading: null, syncing: null, lastSyncTry: 0, nextDueCheck: 0,
});

export const catalogConfigured = () => !!process.env.OCTHERA_API_KEY;

// ── Mapping ───────────────────────────────────────────────────────────────────

/** Octhera's provider → our slug; a slug we already use (e.g. "spribe") is reused so old links keep working. */
export function providerSlugFor(code: string, name: string): string {
  const known = new Set(Object.keys(PROVIDER_META));
  const candidates = [code, name].filter(Boolean).flatMap((s) => {
    const lower = s.toLowerCase();
    return [lower.replace(/[^a-z0-9]/g, ""), slugify(lower)];
  });
  return candidates.find((c) => known.has(c)) ?? (slugify(name || code) || "octhera");
}

export function toRow(g: OctheraGame): CatalogGameRow & { externalId: string } {
  const providerCode = (g.provider ?? "").trim();
  const providerName = (g.providerName ?? "").trim() || providerCode || "Octhera";
  const place = classify(g.type, g.name);
  return {
    id: `${OCTHERA_ID_PREFIX}${g.gameUid}`,
    externalId: g.gameUid,
    name: g.name.trim(),
    providerCode,
    providerName,
    providerSlug: providerSlugFor(providerCode, providerName),
    rawType: (g.type ?? "").trim(),
    section: place.section,
    category: place.category,
    img: (g.img ?? "").trim() || gameImageUrl(g.gameUid),
  };
}

export function rowToGame(r: CatalogGameRow): Game {
  return {
    gameID: r.id,
    gameNameEn: r.name,
    img: r.img,
    customGameType: r.category === "slots" ? 0 : 1,
    vendorCode: r.providerCode || "OCTHERA",
    provider: r.providerSlug,
    providerName: r.providerName,
    kind: r.category === "crash" ? "crash" : r.category === "live" ? "live" : undefined,
    section: r.section as Section,
    category: r.category as Category,
    type: r.rawType || undefined,
  };
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean;
  complete: boolean;
  pages: number;
  total: number | null;
  fetched: number;
  added: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  active: number;
  sections: Record<string, Record<string, number>>;
  unknownTypes: Record<string, number>;
  backup: { created: boolean; gameCount: number } | null;
  error: string | null;
}

const FIELDS = ["name", "providerCode", "providerName", "providerSlug", "rawType", "section", "category", "img"] as const;

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** One import from Octhera into catalog_games. Concurrent callers share one run. */
export function syncCatalog(): Promise<SyncResult> {
  state.syncing ??= runSync().finally(() => { state.syncing = null; });
  return state.syncing;
}

async function runSync(): Promise<SyncResult> {
  state.lastSyncTry = Date.now();
  const log = await prisma.catalogSync.create({ data: { source: SOURCE } });
  const result: SyncResult = {
    ok: false, complete: false, pages: 0, total: null, fetched: 0, added: 0, updated: 0,
    reactivated: 0, deactivated: 0, active: 0, sections: {}, unknownTypes: {}, backup: null, error: null,
  };

  try {
    // Back up the pre-Octhera catalog before the first import replaces it.
    const { backupLegacyCatalog } = await import("@/lib/legacyCatalog");
    result.backup = await backupLegacyCatalog();

    const fetched = await fetchCatalog();
    Object.assign(result, { pages: fetched.pages, total: fetched.total, complete: fetched.complete, error: fetched.error });

    const rows = fetched.games.map((g) => {
      const place = classify(g.type, g.name);
      if (!place.known) {
        const t = (g.type ?? "").trim() || "(none)";
        result.unknownTypes[t] = (result.unknownTypes[t] ?? 0) + 1;
      }
      return toRow(g);
    });
    result.fetched = rows.length;

    const existing = new Map(
      (await prisma.catalogGame.findMany({ where: { source: SOURCE } })).map((r) => [r.id, r])
    );
    const now = new Date();

    const fresh = rows.filter((r) => !existing.has(r.id));
    for (const part of chunks(fresh, 500)) {
      const { count } = await prisma.catalogGame.createMany({
        data: part.map((r) => ({ ...r, source: SOURCE, firstSeenAt: now, lastSeenAt: now })),
        skipDuplicates: true,
      });
      result.added += count;
    }

    const changed = rows.filter((r) => {
      const e = existing.get(r.id);
      return e && FIELDS.some((f) => e[f] !== r[f]);
    });
    for (const part of chunks(changed, 100)) {
      await prisma.$transaction(part.map((r) =>
        prisma.catalogGame.update({ where: { id: r.id }, data: Object.fromEntries(FIELDS.map((f) => [f, r[f]])) })
      ));
    }
    result.updated = changed.length;

    // Everything Octhera sent is live again (a game can come back).
    const seenIds = rows.map((r) => r.id);
    result.reactivated = rows.filter((r) => existing.get(r.id)?.active === false).length;
    for (const part of chunks(seenIds, 1000)) {
      await prisma.catalogGame.updateMany({
        where: { id: { in: part } },
        data: { active: true, deactivatedAt: null, lastSeenAt: now },
      });
    }

    // Only a complete list may take games off the site.
    if (fetched.complete && rows.length > 0) {
      const seen = new Set(seenIds);
      const gone = [...existing.values()].filter((e) => e.active && !seen.has(e.id)).map((e) => e.id);
      for (const part of chunks(gone, 1000)) {
        await prisma.catalogGame.updateMany({
          where: { id: { in: part } },
          data: { active: false, deactivatedAt: now },
        });
      }
      result.deactivated = gone.length;
    }

    const counts = await prisma.catalogGame.groupBy({
      by: ["section", "category"], where: { source: SOURCE, active: true }, _count: { _all: true },
    });
    for (const c of counts) {
      (result.sections[c.section] ??= {})[c.category] = c._count._all;
      result.active += c._count._all;
    }
    result.ok = true;
    console.log(
      `[catalog] import: ${result.fetched} from Octhera (${result.pages} pages, total ${result.total ?? "?"}), ` +
      `+${result.added} new, ${result.updated} updated, ${result.deactivated} removed, ${result.active} on the site` +
      (result.complete ? "" : ` — INCOMPLETE: ${result.error}`)
    );
    if (Object.keys(result.unknownTypes).length) {
      console.warn("[catalog] Octhera types filed under Games → More Games:", result.unknownTypes);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    console.warn("[catalog] import failed:", result.error);
  }

  await prisma.catalogSync.update({
    where: { id: log.id },
    data: {
      finishedAt: new Date(), ok: result.ok, complete: result.complete, pages: result.pages,
      total: result.total, fetched: result.fetched, added: result.added, updated: result.updated,
      reactivated: result.reactivated, deactivated: result.deactivated,
      sections: result.sections, unknownTypes: result.unknownTypes, error: result.error,
    },
  });
  state.readAt = 0; // next read picks the import up
  return result;
}

// ── Reading ───────────────────────────────────────────────────────────────────

async function readActive(): Promise<void> {
  const rows = await prisma.catalogGame.findMany({
    where: { source: SOURCE, active: true },
    orderBy: [{ providerName: "asc" }, { name: "asc" }],
  });
  state.games = rows.map(rowToGame);
  state.readAt = Date.now();
}

async function syncDue(): Promise<boolean> {
  if (!catalogConfigured() || state.syncing) return false;
  const sinceTry = Date.now() - state.lastSyncTry;
  if (sinceTry < RETRY_AFTER_FAIL_MS || Date.now() < state.nextDueCheck) return false;
  // One look a minute, not one per page view (several app instances share the table).
  state.nextDueCheck = Date.now() + READ_TTL_MS;
  const last = await prisma.catalogSync.findFirst({
    where: { source: SOURCE, ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true },
  });
  return !last || Date.now() - last.startedAt.getTime() > SYNC_EVERY_MS;
}

/**
 * Make sure the catalog is in memory. Pages and routes await this, then use
 * the synchronous getters in lib/games. Never throws — a database or Octhera
 * problem leaves whatever was loaded last.
 */
export async function loadCatalog(): Promise<void> {
  try {
    if (Date.now() - state.readAt > READ_TTL_MS) {
      state.reading ??= readActive().finally(() => { state.reading = null; });
      await state.reading;
    }
    if (await syncDue()) {
      const run = syncCatalog();
      run.catch((e) => console.warn("[catalog] import failed:", e instanceof Error ? e.message : e));
      if (state.games.length === 0) {
        // Nothing to show yet — wait a little for the first import.
        await Promise.race([run.catch(() => null), new Promise((r) => setTimeout(r, FIRST_LOAD_WAIT_MS))]);
        await readActive();
      }
    }
  } catch (e) {
    console.warn("[catalog] load failed:", e instanceof Error ? e.message : e);
  }
}

/** Active catalog games, as last loaded. */
export function catalogGames(): Game[] {
  return state.games;
}

/** For the empty state: why there are no games yet. */
export async function catalogStatus(): Promise<{
  configured: boolean; games: number; lastSync: { at: Date; ok: boolean; complete: boolean; error: string | null } | null;
}> {
  const last = await prisma.catalogSync.findFirst({
    where: { source: SOURCE, finishedAt: { not: null } }, orderBy: { startedAt: "desc" },
  }).catch(() => null);
  return {
    configured: catalogConfigured(),
    games: state.games.length,
    lastSync: last ? { at: last.startedAt, ok: last.ok, complete: last.complete, error: last.error } : null,
  };
}

/** Tests: forget everything loaded in this process. */
export function resetCatalogCache(): void {
  Object.assign(state, { games: [], readAt: 0, reading: null, syncing: null, lastSyncTry: 0, nextDueCheck: 0 });
}
