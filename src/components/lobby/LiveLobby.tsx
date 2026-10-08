import { getLiveCasinoGames } from "@/lib/games";
import { LIVE_GROUPS, splitByGroup } from "@/lib/gameGroups";
import { getPlayedPopular, getRecentlyAdded, providersIn, takeFresh } from "@/lib/homeSections";
import { getHomePromoSlots } from "@/lib/homePromos";
import { GameCarousel } from "@/components/vinna/GameCarousel";
import { GameGrid } from "@/components/vinna/GameGrid";
import { PromoSlot } from "@/components/vinna/PromoSlot";
import { CategoryTiles } from "@/components/vinna/CategoryTiles";
import { ProviderTiles } from "@/components/vinna/ProviderTiles";
import { LobbyHeader } from "./LobbyHeader";
import { freshOrAll } from "./fresh";
import type { Game } from "@/types/games";

const ALL = 100_000;
const BASE = "/casino/live";

/*
 * Live Casino lobby (/casino/live). Everything comes from the live tables in
 * the catalog: groups by the provider's game type (lib/gameGroups), Popular
 * from real plays, New from catalog dates. A group or section with no games
 * isn't shown; nothing here states player counts, seats or limits.
 */
export async function LiveLobby() {
  const live = getLiveCasinoGames(ALL);
  const ids = new Set(live.map((g) => g.gameID));
  const isLive = (g: Game) => ids.has(g.gameID);

  const [played, recent, promos] = await Promise.all([
    getPlayedPopular(24, isLive), getRecentlyAdded(24, isLive), getHomePromoSlots("live"),
  ]);
  const groups = splitByGroup(live, LIVE_GROUPS);
  const group = (id: string) => groups.find((g) => g.id === id)?.games ?? [];

  const seen = new Set<string>();
  // Real popularity when there is enough of it; otherwise the catalog's own
  // order (tables with artwork first), labelled as featured, not popular.
  const popular = takeFresh(played.length ? played : live, 16, seen);
  const roulette = freshOrAll(group("roulette"), 16, seen);
  const blackjack = freshOrAll(group("blackjack"), 16, seen);
  const baccarat = freshOrAll(group("baccarat"), 16, seen);
  const shows = freshOrAll(group("gameshow"), 12, seen);
  const others = ["poker", "dragontiger", "dice", "andarbahar"]
    .map((id) => ({ meta: LIVE_GROUPS.find((g) => g.id === id)!, games: freshOrAll(group(id), 16, seen) }))
    .filter((o) => o.games.length >= 3);
  const fresh = freshOrAll(recent, 16, seen);

  const n = (id: string) => `${group(id).length.toLocaleString()} games`;
  const tiles = [
    { id: "all", label: "All live", icon: "live", href: `${BASE}?view=all`, count: live.length },
    ...groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon, href: `${BASE}?sub=${g.id}`, count: g.games.length })),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-7 sm:gap-10">
      <LobbyHeader eyebrow="Real dealers" title="Live Casino" description="Roulette, blackjack, baccarat and game shows, streamed live."
        allHref={`${BASE}?view=all`} count={live.length} />

      <GameGrid title={played.length ? "Popular live tables" : "Featured live tables"}
        description={played.length ? "Most played live games this month" : "From the live floor"}
        games={popular} href={`${BASE}?view=all`} tag="live" eager={6} />

      <CategoryTiles tiles={tiles} label="Live casino categories" />

      <PromoSlot rows={promos.after_first} />

      <GameCarousel title="Live roulette" description={n("roulette")} games={roulette} href={`${BASE}?sub=roulette`} tag="live" />
      <GameGrid title="Live blackjack" description={n("blackjack")} games={blackjack} href={`${BASE}?sub=blackjack`} tag="live" />
      <GameCarousel title="Live baccarat" description={n("baccarat")} games={baccarat} href={`${BASE}?sub=baccarat`} tag="live" />

      <PromoSlot rows={promos.middle} />

      {shows.length > 0 && (
        <div className="sm:rounded-[22px] sm:bg-[var(--v-bg-1)] sm:border sm:border-[color:var(--v-line)] sm:p-6 sm:overflow-hidden">
          <GameCarousel title="Live game shows" description={n("gameshow")} games={shows} href={`${BASE}?sub=gameshow`} tag="live" shape="wide" />
        </div>
      )}

      {others.map((o) => (
        <GameCarousel key={o.meta.id} title={`Live ${o.meta.label.toLowerCase()}`} description={n(o.meta.id)} games={o.games} href={`${BASE}?sub=${o.meta.id}`} tag="live" />
      ))}

      <ProviderTiles title="Live providers" description="Studios streaming to VinnaBet" providers={providersIn(live)} query="?type=live" />

      <PromoSlot rows={promos.lower} />

      <GameCarousel title="New live tables" description="Recently added to the live floor" games={fresh} href={`${BASE}?view=all`} tag="new" />
    </div>
  );
}
