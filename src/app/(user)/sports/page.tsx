import type { Metadata } from "next";
import { CategoryBrowser } from "@/components/casino/CategoryBrowser";
import { CATEGORY_THEMES } from "@/components/casino/categoryThemes";
import { catalogMode, getSectionGames, loadGames } from "@/lib/games";

export const metadata: Metadata = {
  title: "Sports Betting — Football, Live Odds & More",
  description:
    "Bet on football and live sports at VinnaBet. Pre-match and in-play odds in ETB, with instant telebirr, CBE Birr and eBirr deposits.",
  alternates: { canonical: "/sports" },
};

/*
 * Sports = the sportsbook content in Octhera's catalog (sportsbook, virtual
 * sports, esports). Each one opens through Octhera on the player's normal
 * balance, like any other game.
 *
 * When Octhera's catalog has no sports content, this page renders nothing
 * and SportsPane (in the layout) shows the existing sportsbook instead, so
 * Sports never goes blank. The layout makes the same check.
 */
export default async function SportsPage() {
  if (catalogMode() !== "octhera") return null;
  await loadGames();
  const games = getSectionGames("sports");
  if (!games.length) return null;

  const theme = CATEGORY_THEMES.live;
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div
        className="relative overflow-hidden rounded-3xl mb-7 px-6 sm:px-8 py-7 sm:py-9 border border-white/15"
        style={{ background: "linear-gradient(150deg,#3BE6A6 0%,#10B57E 55%,#067A53 100%)", boxShadow: `0 18px 44px rgba(0,0,0,0.45)` }}
      >
        <span aria-hidden className="pointer-events-none absolute -bottom-6 right-4 text-[110px] sm:text-[140px] leading-none opacity-90 select-none">⚽</span>
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">Bet on sports</p>
          <h1 className="font-display text-[28px] sm:text-[38px] font-extrabold tracking-[-0.02em] leading-none text-white mt-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
            Sports
          </h1>
          <span className="inline-block mt-3 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1 text-[12px] font-bold text-white tabular-nums">
            {games.length} {games.length === 1 ? "sportsbook" : "sportsbooks & games"}
          </span>
        </div>
      </div>

      <CategoryBrowser games={games} subcats={[]} accent={theme.accent} />
    </div>
  );
}
