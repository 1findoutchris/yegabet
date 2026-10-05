import {
  getCrashGames, getSlotGames, getNewGames, getPopularGames, getSectionCategories, getSectionGames,
  catalogMode, loadGames,
} from "@/lib/games";
import { GamesPageSection, type GamesTab } from "@/components/casino/GamesPageSection";
import { CatalogNotice } from "@/components/casino/CatalogNotice";
import { AdBoard } from "@/components/ads/AdBoard";
import { getActiveAds } from "@/lib/ads";
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
  const { tab } = await searchParams;
  await loadGames();
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      <AdBoard ads={boardAds} />

      {tabs.length === 0 && catalogMode() === "octhera" ? (
        <CatalogNotice />
      ) : (
        <GamesPageSection
          popularGames={popularGames}
          tabs={tabs}
          initialTab={typeof tab === "string" ? tab : undefined}
        />
      )}
    </div>
  );
}
