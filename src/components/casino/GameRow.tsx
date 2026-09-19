"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { GameCard, type GameBadge } from "./GameCard";
import type { Game } from "@/types/games";

interface GameRowProps {
  title: string;
  icon: React.ReactNode;
  games: Game[];
  viewAllHref?: string;
  accentColor?: string;
  badge?: GameBadge;
  mobileGrid?: boolean;
}

export function GameRow({
  title, icon, games, viewAllHref,
  accentColor = "text-[color:var(--gold)]",
  badge,
  mobileGrid = false,
}: GameRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "right" ? 720 : -720, behavior: "smooth" });
  };

  if (!games.length) return null;

  return (
    <section className="cv-auto mb-6 md:mb-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className={accentColor}>{icon}</span>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">{title}</h2>
        <span className="text-[color:var(--text-muted)] text-[11px] ml-1">{games.length}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="group/see flex items-center gap-1 text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--gold)] transition-colors duration-150"
            >
              See all
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
          <button
            onClick={() => scroll("left")}
            className="hidden md:flex w-7 h-7 rounded-lg items-center justify-center bg-[var(--bg-elevated)] hover:border-[color:var(--border-accent)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll("right")}
            className="hidden md:flex w-7 h-7 rounded-lg items-center justify-center bg-[var(--bg-elevated)] hover:border-[color:var(--border-accent)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {mobileGrid ? (
        <>
          <div className="md:hidden grid grid-cols-3 gap-2">
            {games.slice(0, 6).map((game) => (
              <GameCard key={game.gameID} game={game} className="w-full" badge={badge} />
            ))}
          </div>
          <div ref={scrollRef} className="hidden md:flex gap-3 overflow-x-auto scrollbar-hide pb-1 snap-x snap-mandatory">
            {games.map((game) => (
              <GameCard key={game.gameID} game={game} className="snap-start w-[155px] lg:w-[170px] xl:w-[185px]" badge={badge} />
            ))}
          </div>
        </>
      ) : (
        <div ref={scrollRef} className="flex gap-2.5 md:gap-3 overflow-x-auto scrollbar-hide pb-1 snap-x snap-mandatory">
          {games.map((game) => (
            <GameCard
              key={game.gameID}
              game={game}
              className="snap-start w-[120px] sm:w-[135px] md:w-[150px] lg:w-[165px] xl:w-[180px]"
              badge={badge}
            />
          ))}
        </div>
      )}
    </section>
  );
}
