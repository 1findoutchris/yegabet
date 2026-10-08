import {
  getCrashGames, getSlotGames, getNewGames, getPopularGames, getSectionCategories, getSectionGames,
  catalogMode, loadGames,
} from "@/lib/games";
import { GamesPageSection, type GamesTab } from "@/components/casino/GamesPageSection";
import { GamesLobby } from "@/components/lobby/GamesLobby";
import { CatalogNotice } from "@/components/casino/CatalogNotice";
import { AdBoard } from "@/components/ads/AdBoard";
import { getActiveAds } from "@/lib/ads";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Games — Crash, Instant, Fishing & More",
  description:
    "Browse every game at VinnaBet: crash and instant games, fishing, lottery, keno and more. Play in ETB with telebirr, CBE Birr and eBirr.",
  alternates: { canonical: "/games" },
};

/*
 * The Games section: everything that isn't a casino title or sportsbook —
 * crash & instant, fishing, lottery & keno, arcade (Octhera's types, see
 * lib/catalogClassify). One tab per type that has games.
 */
export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab, sub } = await searchParams;
  await loadGames();

  // No tab: the Games lobby (sections, category tiles, providers). A tab —
  // from "View all" or a category tile — opens that category's full list.
  if (typeof tab !== "string" && catalogMode() === "octhera" && getSectionCategories("games").length > 0) {
    const boardAds = await getActiveAds("BOARD");
    return <GamesLobby ads={boardAds.length ? <AdBoard ads={boardAds} /> : null} />;
  }
  const popularGames = getPopularGames();
  const boardAds     = await getActiveAds("BOARD");

  const tabs: GamesTab[] = catalogMode() === "octhera"
    ? getSectionCategories("games").map((c) => ({
        id: c.id,
        label: c.label,
        // Crash keeps the popular ones first, as on the old page.
        games: c.id === "crash" ? getCrashGames(100_000) : getSectionGames("games", c.id),
      }))
    : [
        { id: "crash", label: "Crash & Instant", games: getCrashGames(500) },
        { id: "slots", label: "Slots",           games: getSlotGames(48) },
        { id: "new",   label: "New Games",       games: getNewGames(48) },
      ].filter((t) => t.games.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-7">
      <header>
        {typeof tab === "string" && (
          <Link href="/games" className="inline-flex items-center gap-1 h-8 pl-1.5 pr-3 -ml-1.5 mb-2 rounded-full text-[12px] font-semibold text-[color:var(--v-text-3)] hover:text-white hover:bg-[var(--v-bg-2)] transition-colors">
            <ChevronLeft className="w-4 h-4" /> Games lobby
          </Link>
        )}
        <p className="v-eyebrow text-[color:var(--v-teal)]">Instant games</p>
        <h1 className="mt-1.5 text-[length:var(--v-fs-page)] font-extrabold tracking-[-0.03em] leading-none text-white">Games</h1>
        <p className="mt-2 text-[14px] text-[color:var(--v-text-3)]">Quick rounds and instant results, away from the casino floor.</p>
      </header>

      <AdBoard ads={boardAds} />

      {tabs.length === 0 && catalogMode() === "octhera" ? (
        <CatalogNotice />
      ) : (
        <GamesPageSection
          popularGames={popularGames}
          tabs={tabs}
          initialTab={typeof tab === "string" ? tab : undefined}
          initialSub={typeof sub === "string" ? sub : undefined}
        />
      )}
    </div>
  );
}
