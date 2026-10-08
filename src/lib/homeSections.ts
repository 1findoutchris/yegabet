import "server-only";
import { prisma } from "@/lib/prisma";
import { catalogMode, getGamesByIds } from "@/lib/games";
import { SPORTSBOOK_GAME_UID, type Game } from "@/types/games";

/*
 * Real-data lists for the lobby. The older "hot"/"new" lists in lib/games are
 * daily shuffles of the catalog, so they can't honestly be called popular or
 * new; these come from what actually happened.
 */

const POPULAR_WINDOW_DAYS = 30;
/** Fewer played games than this and "Popular" isn't meaningful yet — hidden. */
export const MIN_POPULAR = 4;

/**
 * Games played by the most distinct players in the last 30 days, from
 * recent_games (one row per player and game, refreshed on every launch).
 * Ties go to the game with more total launches.
 */
export async function getPlayedPopular(limit: number): Promise<Game[]> {
  const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.recentGame
    .groupBy({
      by: ["gameId"],
      where: { lastPlayedAt: { gte: since }, gameId: { not: SPORTSBOOK_GAME_UID } },
      _count: { userId: true },
      _sum: { playCount: true },
      orderBy: [{ _count: { userId: "desc" } }, { _sum: { playCount: "desc" } }],
      take: Math.max(limit * 2, 40),
    })
    .catch(() => []);
  // Only games still in the catalog, in popularity order.
  const games = getGamesByIds(rows.map((r) => r.gameId)).slice(0, limit);
  return games.length >= MIN_POPULAR ? games : [];
}

const NEW_WINDOW_DAYS = 45;

/**
 * Games that entered the catalog recently — newest first. The first import
 * adds the whole catalog at once, so anything first seen within a day of that
 * import is the original catalog, not "new". Legacy (file) catalogs carry no
 * dates, so there is no New list there.
 */
export async function getRecentlyAdded(limit: number): Promise<Game[]> {
  if (catalogMode() !== "octhera") return [];
  const first = await prisma.catalogGame
    .aggregate({ where: { source: "octhera" }, _min: { firstSeenAt: true } })
    .catch(() => null);
  const importedAt = first?._min.firstSeenAt;
  if (!importedAt) return [];
  const after = new Date(Math.max(importedAt.getTime() + 86_400_000, Date.now() - NEW_WINDOW_DAYS * 86_400_000));
  const rows = await prisma.catalogGame
    .findMany({
      where: { source: "octhera", active: true, firstSeenAt: { gt: after } },
      orderBy: { firstSeenAt: "desc" },
      take: limit * 2,
      select: { id: true },
    })
    .catch(() => []);
  return getGamesByIds(rows.map((r) => r.id)).filter((g) => g.img).slice(0, limit);
}

/** Take up to `n` games not already shown higher up, and mark them shown. */
export function takeFresh(games: Game[], n: number, seen: Set<string>): Game[] {
  const out: Game[] = [];
  for (const g of games) {
    if (out.length >= n) break;
    if (seen.has(g.gameID)) continue;
    out.push(g);
    seen.add(g.gameID);
  }
  return out;
}
