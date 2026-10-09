import { getPopularGames, getSectionCategories, getSectionGames } from "@/lib/games";
import { FAST_GROUPS, splitByGroup } from "@/lib/gameGroups";
import { getPlayedPopular, getRecentlyAdded, providersIn, takeFresh } from "@/lib/homeSections";
import { getHomePromoSlots } from "@/lib/homePromos";
import { GameCarousel } from "@/components/vinna/GameCarousel";
import { GameGrid } from "@/components/vinna/GameGrid";
import { PromoSlot } from "@/components/vinna/PromoSlot";
import { CategoryTiles, type CategoryTile } from "@/components/vinna/CategoryTiles";
import { ProviderTiles } from "@/components/vinna/ProviderTiles";
import { LobbyHeader } from "./LobbyHeader";
import { freshOrAll } from "./fresh";
import type { Game } from "@/types/games";

const ICON: Record<string, string> = { fishing: "fishing", lottery: "keno", arcade: "arcade", other: "all" };
const SHORT: Record<string, string> = { fishing: "Fishing", lottery: "Lottery & Keno", arcade: "Arcade", other: "More games" };

/*
 * Games lobby (/games): the catalog's Games section — crash & instant,
 * fishing, lottery, arcade — arranged by the provider's own game types
 * (lib/gameGroups). Featured = the existing hand-picked crash list (only
 * titles that are in the catalog), or real plays when there are enough.
 * Empty groups and categories aren't shown.
 */
export async function GamesLobby({ ads }: { ads?: React.ReactNode }) {
  const all = getSectionGames("games");
  const ids = new Set(all.map((g) => g.gameID));
  const isFast = (g: Game) => ids.has(g.gameID);
  const fast = all.filter((g) => g.category === "crash");
  const categories = getSectionCategories("games");

  const [played, recent, promos] = await Promise.all([
    getPlayedPopular(24, isFast), getRecentlyAdded(24, isFast), getHomePromoSlots("games"),
  ]);
  const groups = splitByGroup(fast, FAST_GROUPS);
  const group = (id: string) => groups.find((g) => g.id === id)?.games ?? [];
  const label = (id: string) => FAST_GROUPS.find((g) => g.id === id)!.label;
  const sub = (id: string) => `/games?tab=crash&sub=${id}`;
  const n = (id: string) => `${group(id).length.toLocaleString()} games`;

  const seen = new Set<string>();
  const featured = takeFresh(played.length ? played : getPopularGames(), 16, seen);
  const crash = freshOrAll(group("crash"), 16, seen);
  const instant = freshOrAll(group("instant"), 16, seen);
  // Mines, Plinko and Dice: a row each when there are plenty, otherwise one
  // shared grid so a handful of games doesn't make three thin rows.
  const trio = ["mines", "plinko", "dice"].map((id) => ({ id, games: group(id) }));
  const own = trio.filter((t) => t.games.length >= 6).map((t) => ({ ...t, games: freshOrAll(t.games, 16, seen) }));
  const pooledIds = trio.filter((t) => t.games.length > 0 && t.games.length < 6);
  const pooled = takeFresh(pooledIds.flatMap((t) => t.games), 16, seen);
  const more = ["wheel", "hilo"].map((id) => ({ id, games: freshOrAll(group(id), 16, seen) })).filter((t) => t.games.length >= 3);
  const extra = categories
    .filter((c) => c.id !== "crash")
    .map((c) => ({ ...c, games: freshOrAll(getSectionGames("games", c.id), 16, seen) }));
  const fresh = freshOrAll(recent, 16, seen);

  const tiles: CategoryTile[] = [
    ...groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon, href: sub(g.id), count: g.games.length })),
    ...categories.filter((c) => c.id !== "crash").map((c) => ({ id: c.id, label: SHORT[c.id] ?? c.label, icon: ICON[c.id] ?? "all", href: `/games?tab=${c.id}`, count: c.count })),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-7 sm:gap-10">
      <LobbyHeader eyebrow="Fast games" title="Games" description="Crash, instant and quick-round games."
        allHref="/games?tab=crash" count={all.length} />

      <GameGrid title={played.length ? "Popular fast games" : "Featured fast games"}
        description={played.length ? "Most played this month" : "Crash and instant favourites"}
        games={featured} href="/games?tab=crash" eager={6} />

      <CategoryTiles tiles={tiles} label="Game categories" />

      <GameCarousel title="Crash games" description={n("crash")} games={crash} href={sub("crash")} />

      <PromoSlot rows={promos.after_first} />

      <GameGrid title="Instant games" description={n("instant")} games={instant} href={sub("instant")} />

      {own.map((t) => (
        <GameCarousel key={t.id} title={label(t.id)} description={n(t.id)} games={t.games} href={sub(t.id)} />
      ))}
      {pooled.length >= 3 && (
        <GameGrid title={pooledIds.map((t) => label(t.id)).join(", ").replace(/, ([^,]*)$/, " & $1")}
          games={pooled} href="/games?tab=crash" />
      )}

      {more.map((t) => (
        <GameCarousel key={t.id} title={label(t.id)} description={n(t.id)} games={t.games} href={sub(t.id)} />
      ))}

      <PromoSlot rows={promos.middle} />

      {extra.map((c) => (
        <GameCarousel key={c.id} title={SHORT[c.id] ?? c.label} description={`${c.count.toLocaleString()} games`} games={c.games} href={`/games?tab=${c.id}`} />
      ))}

      <ProviderTiles title="Game providers" description="Studios behind the fast games" providers={providersIn(all)} query="?section=games" />

      <GameCarousel title="New games" description="Recently added" games={fresh} href="/games?tab=crash" tag="new" />

      {ads}

      <PromoSlot rows={promos.lower} />
    </div>
  );
}
