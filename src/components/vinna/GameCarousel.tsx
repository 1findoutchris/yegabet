"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameCard, type GameTag } from "./GameCard";
import { SectionHeader } from "./SectionHeader";
import type { Game } from "@/types/games";

/**
 * One content-stream section: header with "View all", then a snap-scrolling
 * row of ~140px cards that bleeds to the screen edge on phones. `grid` turns
 * the phone layout into a two-column grid of the first four games.
 */
export function GameCarousel({
  title,
  description,
  games,
  href,
  tag,
  grid = false,
  eager = 0,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  games: Game[];
  href?: string;
  tag?: GameTag;
  grid?: boolean;
  /** How many leading cards load eagerly (only for a row near the top). */
  eager?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (!games.length) return null;

  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 700, behavior: "smooth" });
  const arrows = (
    <div className="hidden md:flex gap-1.5">
      {[-1, 1].map((d) => (
        <button
          key={d}
          onClick={() => scroll(d as 1 | -1)}
          aria-label={d < 0 ? "Scroll left" : "Scroll right"}
          className="w-8 h-8 grid place-items-center rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)] text-[color:var(--v-text-2)] hover:text-white hover:border-[color:var(--v-line-2)] transition-colors"
        >
          {d < 0 ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      ))}
    </div>
  );

  return (
    <section className="cv-auto v-fade-up">
      <SectionHeader title={title} description={description} href={href} actions={arrows} />
      {grid && (
        <div className="md:hidden grid grid-cols-2 gap-3">
          {games.slice(0, 4).map((g, i) => <GameCard key={g.gameID} game={g} tag={tag} eager={i < eager} />)}
        </div>
      )}
      <div ref={ref} className={"v-rail pb-1 " + (grid ? "hidden md:flex" : "")}>
        {games.map((g, i) => (
          <GameCard key={g.gameID} game={g} tag={tag} eager={i < eager} className="w-[29vw] max-w-[128px] sm:w-[136px] sm:max-w-none lg:w-[146px]" />
        ))}
      </div>
    </section>
  );
}
