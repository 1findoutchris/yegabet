import { takeFresh } from "@/lib/homeSections";
import type { Game } from "@/types/games";

/**
 * Games for a lobby section, preferring ones not shown higher up. When that
 * would leave the section nearly empty (a small catalog), the section shows
 * its own games anyway rather than disappearing.
 */
export function freshOrAll(games: Game[], n: number, seen: Set<string>, min = 4): Game[] {
  const fresh = takeFresh(games, n, seen);
  if (fresh.length >= Math.min(min, games.length)) return fresh;
  const all = games.slice(0, n);
  for (const g of all) seen.add(g.gameID);
  return all;
}
