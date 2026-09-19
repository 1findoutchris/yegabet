import { auth } from "@/lib/auth";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import {
  getHotGames, getNewGames, getSlotGames,
  getLiveCasinoGames, getGamesByProvider, getProviderStats,
  getCategoryCounts,
} from "@/lib/games";
import { GameSearch }       from "@/components/casino/GameSearch";
import { CategoryGrid }       from "@/components/casino/CategoryGrid";
import { MyCasinoEntry }      from "@/components/casino/MyCasinoEntry";
import { CasinoGamesSection } from "@/components/casino/CasinoGamesSection";
import { PromotionsSection, type Promo } from "@/components/casino/PromotionsSection";
import { reloadWindowOpen }   from "@/lib/depositBonusCore";
import { tierForPoints }      from "@/lib/retention";
import { RankProgress }       from "@/components/retention/RankProgress";
import { AdPopup }            from "@/components/ads/AdPopup";
import { getActiveAds }       from "@/lib/ads";
import "@/components/casino/casino.css";
import type { Metadata } from "next";

// `/` redirects here carrying its query string, so the lobby is the real
// landing page and takes the site's headline title.
export const metadata: Metadata = {
  title: "Online Casino & Sports Betting in Ethiopia",
  description:
    "Play 1000+ slots, crash and live casino games at VinnaBet. Instant telebirr, CBE Birr and eBirr deposits, fast withdrawals in ETB.",
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

  const hotGames  = getHotGames(24);
  const newGames  = getNewGames(24);
  const slotGames = getSlotGames(24);
  const liveGames = getLiveCasinoGames(24);
  const pgGames   = getGamesByProvider("pgsoft", 24);
  const providers = getProviderStats();
  const catCounts = getCategoryCounts();

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-10 pb-16">
        {/* Above the categories: the lobby shows a few dozen curated games, so
            search is the only way to reach the other ~8,000 from here. */}
        <GameSearch />

        {/* Vibrant category tiles — top of the lobby, primary navigation */}
        <CategoryGrid counts={catCounts} />

        {/* Gamified portal into the personal player hub */}
        <MyCasinoEntry />

        <CasinoGamesSection
          hotGames={hotGames}
          newGames={newGames}
          slotGames={slotGames}
          liveGames={liveGames}
          pgGames={pgGames}
          providers={providers}
        />

        <RankProgress points={points} tiers={tiers} />

        <PromotionsSection promos={promos} />
      </div>

      <AdPopup ads={popupAds} />

      <footer className="border-t border-[color:var(--border-muted)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap gap-6">
          <span className="text-[12px] text-[color:var(--text-muted)] cursor-pointer hover:text-[color:var(--text-secondary)] transition-colors">Responsible gaming</span>
          <span className="text-[12px] text-[color:var(--text-muted)] cursor-pointer hover:text-[color:var(--text-secondary)] transition-colors">Terms &amp; conditions</span>
          <span className="text-[12px] text-[color:var(--text-muted)] cursor-pointer hover:text-[color:var(--text-secondary)] transition-colors">Help center</span>
          <span className="text-[12px] text-[color:var(--text-muted)] ml-auto">18+</span>
        </div>
      </footer>
    </>
  );
}
