import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import {
  getHotGames, getNewGames, getSlotGames, getCrashGames,
  getLiveCasinoGames, getGamesByProvider, getProviderStats,
  getCategoryCounts, getSectionGames, getGamesByIds, getRecommendedFrom,
  catalogMode, loadGames,
} from "@/lib/games";
import { SPORTSBOOK_GAME_UID, type Game } from "@/types/games";
import { CatalogNotice }      from "@/components/casino/CatalogNotice";
import { ProviderSelect }     from "@/components/casino/ProviderSelect";
import { PromotionsSection, type Promo } from "@/components/casino/PromotionsSection";
import { reloadWindowOpen }   from "@/lib/depositBonusCore";
import { tierForPoints }      from "@/lib/retention";
import { AdPopup }            from "@/components/ads/AdPopup";
import { getActiveAds }       from "@/lib/ads";
import { CasinoHero }         from "@/components/vinna/CasinoHero";
import { CategoryTabs, type CategoryTab } from "@/components/vinna/CategoryTabs";
import { GameCarousel }       from "@/components/vinna/GameCarousel";
import { RewardProgress }     from "@/components/vinna/RewardProgress";
import { SearchTrigger }      from "@/components/vinna/SearchTrigger";
import type { Metadata } from "next";

// `/` redirects here carrying its query string, so the lobby is the real
// landing page and takes the site's headline title.
export const metadata: Metadata = {
  title: "Online Casino & Sports Betting in Ethiopia",
  description:
    "Play slots, live casino, table and crash games at VinnaBet. Instant telebirr, CBE Birr and eBirr deposits, fast withdrawals in ETB.",
  alternates: { canonical: "/casino" },
};

export default async function CasinoPage() {
  const session = await auth();
  const points = await getUserPoints(session?.user?.id);
  const { tiers, depositBonus } = await getRewardConfig();
  const popupAds = await getActiveAds("POPUP");

  // Promotions are assembled from live config, so a card only appears when the
  // offer behind it is actually running. The window check happens here rather
  // than in the client component so server and client can't disagree across a
  // day boundary during hydration.
  const tier = tierForPoints(points, tiers);
  const promos: Promo[] = [];
  const { firstDeposit, reload } = depositBonus;

  if (firstDeposit.enabled && firstDeposit.pct > 0 && firstDeposit.maxEtb > 0) {
    promos.push({
      id: "welcome",
      emoji: "🎁",
      title: "Welcome bonus",
      desc: `${Math.round(firstDeposit.pct * 100)}% match on your first deposit up to ETB ${firstDeposit.maxEtb.toLocaleString()}`,
      href: "/deposit",
      cta: "Deposit now",
    });
  }

  if (reloadWindowOpen(reload, new Date()) && reload.pct > 0 && reload.maxEtb > 0) {
    promos.push({
      id: "reload",
      emoji: "🔄",
      title: reload.endsAt ? "Limited-time bonus" : "Deposit bonus",
      desc: `${Math.round(reload.pct * 100)}% bonus every time you top up, up to ETB ${reload.maxEtb.toLocaleString()}`,
      href: "/deposit",
      cta: "Deposit now",
    });
  }

  if (tier.cashbackRate > 0) {
    promos.push({
      id: "cashback",
      emoji: "💸",
      title: "Weekly cashback",
      desc: `Get ${Math.round(tier.cashbackRate * 100)}% back on net losses each week, up to ETB ${tier.cashbackCap.toLocaleString()} at ${tier.name}`,
      href: "/rewards/bonuses",
      cta: "View cashback",
    });
  }

  await loadGames();
  const octhera   = catalogMode() === "octhera";
  const hotGames  = getHotGames(24);
  const newGames  = getNewGames(24);
  const slotGames = getSlotGames(24);
  const liveGames = getLiveCasinoGames(24);
  const crashGames = getCrashGames(24);
  const tableGames = octhera ? getSectionGames("casino", "table").slice(0, 24) : [];
  // Casino providers only — crash/instant and sports have their own sections.
  const providers = getProviderStats(octhera ? "casino" : undefined);
  // A rail for the biggest casino provider (was PG Soft in the old catalog).
  const featured  = octhera ? providers[0] : { slug: "pgsoft", name: "PG Soft" };
  const featuredGames = featured ? getGamesByProvider(featured.slug, 24) : [];
  const catCounts = getCategoryCounts();
  const empty     = octhera && catCounts.all === 0;

  // Personal rails, from what this player has actually played (as My Casino
  // does). Logged out, or with no history yet, they simply don't render.
  let recent: Game[] = [];
  let recommended: Game[] = [];
  if (session?.user?.id) {
    const rows = await prisma.recentGame.findMany({
      where: { userId: session.user.id }, orderBy: { lastPlayedAt: "desc" }, take: 12, select: { gameId: true },
    }).catch(() => []);
    recent = getGamesByIds(rows.map((r) => r.gameId).filter((id) => id !== SPORTSBOOK_GAME_UID));
    const ids = recent.map((g) => g.gameID);
    recommended = ids.length ? getRecommendedFrom(ids, ids, 18) : [];
  }

  // Quick category pills — only ones with games behind them.
  const tabs: CategoryTab[] = [
    { id: "all",   label: "All",     href: "/casino",          count: catCounts.all },
    { id: "crash", label: "Crash",   href: "/games?tab=crash", count: catCounts.crash },
    { id: "slots", label: "Slots",   href: "/casino/slots",    count: catCounts.slots },
    { id: "live",  label: "Live",    href: "/casino/live",     count: catCounts.live },
    { id: "table", label: "Table",   href: "/casino/table",    count: catCounts.table },
    { id: "new",   label: "New",     href: "/casino/new",      count: catCounts.new },
    { id: "hot",   label: "Popular", href: "/casino/hot",      count: catCounts.hot },
  ].filter((t) => t.id === "all" || (t.count ?? 0) > 0);

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-8 sm:gap-10">
        <CasinoHero featured={hotGames.slice(0, 3)} totalGames={catCounts.all} />

        {/* Search + quick categories */}
        <div className="flex flex-col gap-3 -mt-2">
          <SearchTrigger />
          {!empty && (
            <div className="flex items-center gap-3">
              <CategoryTabs tabs={tabs} active="all" className="flex-1 min-w-0" />
              {providers.length > 1 && (
                <div className="shrink-0"><ProviderSelect providers={providers} /></div>
              )}
            </div>
          )}
        </div>

        {empty && <CatalogNotice />}

        <div id="stream" className="flex flex-col gap-9 sm:gap-11 scroll-mt-20">
          <GameCarousel title="Trending games" description="The most popular titles in the lobby"
            games={hotGames} href="/casino/hot" tag="trending" />

          {recent.length > 0 && (
            <GameCarousel title="Jump back in" description="Your recently played" games={recent} href="/my-casino" />
          )}

          {recommended.length > 0 && (
            <GameCarousel title="Recommended for you" description="Picked from the providers you play"
              games={recommended} href="/my-casino" />
          )}

          <GameCarousel title="Live casino" description="Real dealers, streamed live"
            games={liveGames} href="/casino/live" tag="live" />

          <GameCarousel title="Crash games" description="Cash out before it flies"
            games={crashGames} href="/games?tab=crash" />

          <RewardProgress points={points} tiers={tiers} variant="strip" />

          <GameCarousel title="Slots" description="Spin across every provider"
            games={slotGames} href="/casino/slots" grid />

          <GameCarousel title="New releases" description="The latest additions to the lobby"
            games={newGames} href="/casino/new" tag="new" />

          {tableGames.length > 0 && (
            <GameCarousel title="Table games" description="Blackjack, roulette, baccarat and more"
              games={tableGames} href="/casino/table" />
          )}

          {featured && featuredGames.length > 0 && (
            <GameCarousel title={featured.name} description="Top provider"
              games={featuredGames} href={`/casino/${featured.slug}`} />
          )}

          <PromotionsSection promos={promos} />
        </div>
      </div>

      <AdPopup ads={popupAds} />

      <footer className="border-t border-[color:var(--v-line)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[12px] font-extrabold tracking-[0.2em] text-[color:var(--v-text-3)]">VINNABET</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Responsible gaming</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Terms &amp; conditions</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Help center</span>
          <span className="ml-auto text-[11px] font-bold text-[color:var(--v-text-2)] border border-[color:var(--v-line-2)] rounded-full px-2 py-0.5">18+</span>
        </div>
      </footer>
    </>
  );
}
