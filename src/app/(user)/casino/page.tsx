import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import {
  getSlotGames, getCrashGames, getLiveCasinoGames, getProviderStats,
  getCategoryCounts, getSectionGames, getGamesByIds, getRecommendedFrom,
  catalogMode, loadGames,
} from "@/lib/games";
import { getPlayedPopular, getRecentlyAdded, takeFresh } from "@/lib/homeSections";
import { getHomePromoSlots } from "@/lib/homePromos";
import { SPORTSBOOK_GAME_UID, type Game } from "@/types/games";
import { CatalogNotice }      from "@/components/casino/CatalogNotice";
import { ProviderSelect }     from "@/components/casino/ProviderSelect";
import { PromotionsSection, type Promo } from "@/components/casino/PromotionsSection";
import { reloadWindowOpen }   from "@/lib/depositBonusCore";
import { tierForPoints }      from "@/lib/retention";
import { AdPopup }            from "@/components/ads/AdPopup";
import { getActiveAds }       from "@/lib/ads";
import { CategoryTiles, type CategoryTile } from "@/components/vinna/CategoryTiles";
import { ProviderTiles } from "@/components/vinna/ProviderTiles";
import { GameCarousel }       from "@/components/vinna/GameCarousel";
import { GameGrid }           from "@/components/vinna/GameGrid";
import { PromoSlot }          from "@/components/vinna/PromoSlot";
import { RewardProgress }     from "@/components/vinna/RewardProgress";
import { SearchTrigger }      from "@/components/vinna/SearchTrigger";
import type { Metadata } from "next";

// `/` redirects here carrying its query string, so the lobby is the real
// landing page and takes the site's headline title.
export const metadata: Metadata = {
  title: "Online Casino & Sports Betting in Ethiopia",
  description:
    "Play slots, live casino, table and crash games at YegaBet. Instant telebirr, CBE Birr and eBirr deposits, fast withdrawals in ETB.",
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
  const catCounts = getCategoryCounts();
  const empty     = octhera && catCounts.all === 0;
  // Casino providers only — crash/instant and sports have their own sections.
  const providers = getProviderStats(octhera ? "casino" : undefined);

  // Personal rows, from what this player has actually played. Logged out, or
  // with no history yet, they simply don't render.
  let recent: Game[] = [];
  let recommended: Game[] = [];
  if (session?.user?.id) {
    const rows = await prisma.recentGame.findMany({
      where: { userId: session.user.id }, orderBy: { lastPlayedAt: "desc" }, take: 12, select: { gameId: true },
    }).catch(() => []);
    recent = getGamesByIds(rows.map((r) => r.gameId).filter((id) => id !== SPORTSBOOK_GAME_UID));
    const ids = recent.map((g) => g.gameID);
    recommended = ids.length ? getRecommendedFrom(ids, ids, 24) : [];
  }

  // Sections top to bottom. Each takes games not already shown above it, so
  // scrolling keeps showing new titles. Popular and New are real data
  // (lib/homeSections) and are hidden when there isn't any.
  const seen = new Set<string>();
  const [playedPopular, recentlyAdded, promoSlots] = await Promise.all([
    getPlayedPopular(32), getRecentlyAdded(24), getHomePromoSlots(),
  ]);
  const popular     = takeFresh(playedPopular, 16, seen);
  const crashGames  = takeFresh(getCrashGames(60), 16, seen);
  const slotGames   = takeFresh(getSlotGames(60), 16, seen);
  const liveGames   = takeFresh(getLiveCasinoGames(60), 16, seen);
  const newGames    = takeFresh(recentlyAdded, 16, seen);
  const tableGames  = octhera ? takeFresh(getSectionGames("casino", "table"), 16, seen) : [];
  const forYou      = takeFresh(recommended, 16, seen);

  // Illustrated category tiles — only ones with games behind them. Popular
  // and New carry no count: their size isn't a fixed catalog number.
  const tiles: CategoryTile[] = [
    { id: "slots", label: "Slots",       icon: "slots",   href: "/casino/slots", count: catCounts.slots },
    { id: "live",  label: "Live Casino", icon: "live",    href: "/casino/live",  count: catCounts.live },
    { id: "table", label: "Table Games", icon: "table",   href: "/casino/table", count: catCounts.table },
    { id: "crash", label: "Crash",       icon: "crash",   href: "/games",        count: catCounts.crash },
    { id: "hot",   label: "Popular",     icon: "popular", href: "/casino/hot",   count: catCounts.hot > 0 ? undefined : 0 },
    { id: "new",   label: "New",         icon: "new",     href: "/casino/new",   count: catCounts.new > 0 ? undefined : 0 },
  ].filter((t) => t.count !== 0);

  // The first section on the page loads its artwork eagerly; the rest lazily.
  const firstEager = 6;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-7 sm:gap-10">
        {/* Search, provider picker and category tiles — games start right below */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0"><SearchTrigger /></div>
            {!empty && providers.length > 1 && <ProviderSelect providers={providers} />}
          </div>
          {!empty && <CategoryTiles tiles={tiles} label="Casino categories" />}
        </div>

        {empty && <CatalogNotice />}

        <div id="stream" className="flex flex-col gap-7 sm:gap-10 scroll-mt-20">
          {/* B — what players are actually playing */}
          <GameGrid title="Popular now" description="Most played by YegaBet players this month"
            games={popular} href="/casino/hot" eager={firstEager} />

          {recent.length > 0 && (
            <GameCarousel title="Jump back in" description="Your recently played" games={recent} href="/my-casino"
              eager={popular.length ? 0 : firstEager} />
          )}

          {/* C — first promotion slot */}
          <PromoSlot rows={promoSlots.after_first} />

          {/* D — a row */}
          <GameCarousel title="Crash games" description="Cash out before it flies"
            games={crashGames} href="/games?tab=crash"
            eager={popular.length || recent.length ? 0 : firstEager} />

          {/* E — a grid */}
          <GameGrid title="Slots" games={slotGames} href="/casino/slots" />

          <RewardProgress points={points} tiers={tiers} variant="strip" />

          {/* F — middle promotions (usually a pair of posters) */}
          <PromoSlot rows={promoSlots.middle} />

          {/* G — live tables, set apart on their own panel (from tablet up;
              phones keep the full width for three cards across) */}
          {liveGames.length > 0 && (
            <div className="sm:rounded-[22px] sm:bg-[var(--v-bg-1)] sm:border sm:border-[color:var(--v-line)] sm:p-6 sm:overflow-hidden">
              <GameCarousel title="Live casino" description="Real dealers, streamed live"
                games={liveGames} href="/casino/live" tag="live" />
            </div>
          )}

          {/* H — more categories */}
          <GameCarousel title="New in the lobby" description="Recently added games"
            games={newGames} href="/casino/new" tag="new" />

          <GameGrid title="Table games" description="Blackjack, roulette, baccarat and more"
            games={tableGames} href="/casino/table" />

          {forYou.length > 0 && (
            <GameCarousel title="Recommended for you" description="From the providers you play"
              games={forYou} href="/my-casino" />
          )}

          <ProviderTiles title="Providers" description="Studios in the casino" providers={providers} query={octhera ? "?section=casino" : ""} />

          {/* I — lower promotions, then the live bonus offers */}
          <PromoSlot rows={promoSlots.lower} />

          <PromotionsSection promos={promos} />
        </div>
      </div>

      <AdPopup ads={popupAds} />

      <footer className="border-t border-[color:var(--v-line)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[12px] font-extrabold tracking-[0.2em] text-[color:var(--v-text-3)]">YEGABET</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Responsible gaming</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Terms &amp; conditions</span>
          <span className="text-[12px] text-[color:var(--v-text-3)]">Help center</span>
          <span className="ml-auto text-[11px] font-bold text-[color:var(--v-text-2)] border border-[color:var(--v-line-2)] rounded-full px-2 py-0.5">18+</span>
        </div>
      </footer>
    </>
  );
}
