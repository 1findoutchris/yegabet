import Link from "next/link";
import { GameCard } from "./GameCard";
import { HeroCTA } from "./HeroCTA";
import type { Game } from "@/types/games";

/**
 * Lobby hero: the line, two actions, and a fanned stack of three featured
 * games (the lobby's top popular titles — real catalogue entries, playable
 * straight from here). Dark panel with a single light beam, no colour wash.
 */
export function CasinoHero({
  featured,
  totalGames,
}: {
  featured: Game[];
  totalGames: number;
}) {
  const [a, b, c] = featured;
  return (
    <section className="relative overflow-hidden rounded-[26px] border border-[color:var(--v-line)] bg-[var(--v-bg-0)]">
      {/* beam + hairlines */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-1/2 left-[30%] w-[60%] h-[200%] rotate-[24deg] bg-[linear-gradient(90deg,transparent,rgba(255, 122, 0,0.10),transparent)]" />
        <svg className="absolute right-0 top-0 h-full w-2/3 opacity-[0.35]" viewBox="0 0 400 300" preserveAspectRatio="none">
          {Array.from({ length: 7 }).map((_, i) => (
            <path key={i} d={`M ${40 + i * 52} 300 L ${200 + i * 30} 0`} stroke="rgba(200, 200, 200,0.12)" strokeWidth="1" fill="none" />
          ))}
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,var(--v-bg-0),transparent)]" />
      </div>

      <div className="relative grid md:grid-cols-[1.1fr_1fr] gap-6 items-center p-5 sm:p-8 lg:p-10">
        <div className="v-fade-up">
          <p className="v-eyebrow text-[color:var(--v-teal)]">YegaBet Casino</p>
          <h1 className="mt-3 text-[34px] sm:text-[46px] lg:text-[54px] font-extrabold leading-[0.98] tracking-[-0.035em] text-white">
            Play. Win.<br />
            <span className="text-[color:var(--v-teal)]">Repeat.</span>
          </h1>
          <p className="mt-4 max-w-sm text-[14px] sm:text-[15px] leading-relaxed text-[color:var(--v-text-2)]">
            {totalGames > 0 ? `${totalGames.toLocaleString()} games` : "Slots, live tables and crash games"}, instant ETB deposits, and rewards on every round.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <HeroCTA />
            <Link href="#stream" className="v-btn v-btn-ghost h-12 px-6">Explore games</Link>
          </div>
        </div>

        {a && (
          <div className="relative h-[210px] sm:h-[250px] md:h-[300px] hidden min-[380px]:block">
            {c && (
              <div className="absolute left-[8%] top-[12%] w-[34%] max-w-[150px] -rotate-[9deg] opacity-80">
                <GameCard game={c} className="w-full shadow-[var(--v-shadow-3)]" />
              </div>
            )}
            {b && (
              <div className="absolute right-[8%] top-[12%] w-[34%] max-w-[150px] rotate-[9deg] opacity-80">
                <GameCard game={b} className="w-full shadow-[var(--v-shadow-3)]" />
              </div>
            )}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 w-[40%] max-w-[176px]">
              <GameCard game={a} tag="trending" className="w-full shadow-[var(--v-shadow-3)] ring-[color:var(--v-teal-a24)]" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
