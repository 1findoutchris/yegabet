import { getCrashGames, getSlotGames, getNewGames, getPopularGames } from "@/lib/games";
import { GamesPageSection } from "@/components/casino/GamesPageSection";
import { AdBoard } from "@/components/ads/AdBoard";
import { getActiveAds } from "@/lib/ads";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Games — Slots, Crash & New Releases",
  description:
    "Browse every game at VinnaBet: popular titles, crash games, hundreds of slots and the newest releases. Play in ETB with telebirr, CBE Birr and eBirr.",
  alternates: { canonical: "/games" },
};

export default async function GamesPage() {
  const popularGames = getPopularGames();
  const crashGames   = getCrashGames(500);
  const slotGames    = getSlotGames(48);
  const newGames     = getNewGames(48);
  const boardAds     = await getActiveAds("BOARD");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
      <AdBoard ads={boardAds} />

      <GamesPageSection
        popularGames={popularGames}
        crashGames={crashGames}
        slotGames={slotGames}
        newGames={newGames}
      />
    </div>
  );
}
