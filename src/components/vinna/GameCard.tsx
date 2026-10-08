"use client";

import Image from "next/image";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Heart, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Game } from "@/types/games";
import { PROVIDER_META } from "@/types/games";
import { LoginPrompt } from "@/components/casino/LoginPrompt";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useFavorites } from "@/contexts/FavoritesContext";

export type GameTag = "hot" | "new" | "live" | "trending" | "jackpot";

const TAGS: Record<GameTag, { label: string; dot: string; pulse?: boolean }> = {
  hot:      { label: "Hot",      dot: "var(--v-amber)" },
  new:      { label: "New",      dot: "var(--v-teal)" },
  live:     { label: "Live",     dot: "var(--v-red)", pulse: true },
  trending: { label: "Trending", dot: "var(--v-cyan)" },
  jackpot:  { label: "Jackpot",  dot: "var(--v-amber)" },
};

function initials(name: string): string {
  const w = name.split(/[\s_\-]+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

interface Props {
  game: Game;
  tag?: GameTag;
  /** Older call sites pass `badge`; same thing. */
  badge?: GameTag;
  className?: string;
  /** Above the fold: load the artwork right away instead of lazily. */
  eager?: boolean;
}

/**
 * VinnaBet game card: the artwork fills the card, a dark gradient carries the
 * provider and title, a small glass tag sits top-left and the favourite top-
 * right. Opening a game goes through GamePlayerContext exactly as before
 * (Octhera → /game/[id], other providers → overlay player).
 */
export function GameCard({ game, tag, badge, className, eager = false }: Props) {
  const { data: session } = useSession();
  const { open: openGame } = useGamePlayer();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const [imgError, setImgError] = useState(!game.img);
  const [showLogin, setShowLogin] = useState(false);
  const [favTick, setFavTick] = useState(0);

  const providerName = PROVIDER_META[game.provider]?.name ?? game.providerName ?? game.provider.toUpperCase();
  const fav = isFavorite(game.gameID);
  const t = tag ?? badge;

  function play() {
    if (!session) setShowLogin(true);
    else openGame(game);
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Play ${game.gameNameEn} by ${providerName}`}
        onClick={play}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } }}
        className={cn(
          "group relative shrink-0 select-none cursor-pointer rounded-[16px] overflow-hidden aspect-[4/5]",
          "bg-[var(--v-bg-2)] ring-1 ring-[color:var(--v-line)]",
          "transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          "active:scale-[0.97] md:hover:-translate-y-0.5 md:hover:shadow-[var(--v-ring)]",
          "motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:md:hover:translate-y-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)]",
          className
        )}
      >
        {/* Fallback art: always under the image */}
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#15233B,#0A1222)]">
          <span className="absolute inset-0 grid place-items-center text-[36px] font-extrabold text-white/[0.06] tracking-tight">
            {initials(providerName)}
          </span>
        </div>

        {!imgError && game.img && (
          <Image
            src={game.img}
            alt={game.gameNameEn}
            fill
            unoptimized
            priority={eager}
            onError={() => setImgError(true)}
            sizes="(max-width: 640px) 31vw, (max-width: 1024px) 20vw, 150px"
            className="object-cover transition-transform duration-[400ms] ease-out md:group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:md:group-hover:scale-100"
          />
        )}

        {/* Readability gradient */}
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(6,11,22,0.96)_0%,rgba(6,11,22,0.55)_32%,transparent_60%)]" />

        {t && (
          <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 h-5 pl-1.5 pr-2 rounded-full v-glass text-[9px] font-bold uppercase tracking-[0.08em] text-white">
            <span
              className={cn("w-1.5 h-1.5 rounded-full", TAGS[t].pulse && "animate-pulse")}
              style={{ background: TAGS[t].dot }}
            />
            {TAGS[t].label}
          </span>
        )}

        {session && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleFavorite(game.gameID); setFavTick((n) => n + 1); }}
            aria-label={fav ? `Remove ${game.gameNameEn} from favorites` : `Add ${game.gameNameEn} to favorites`}
            aria-pressed={fav}
            className={cn(
              "absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full grid place-items-center v-glass transition-colors",
              fav ? "text-[color:var(--v-red)]" : "text-white/85 hover:text-white"
            )}
          >
            <Heart key={favTick} className={cn("w-3.5 h-3.5", favTick > 0 && "v-heart", fav && "fill-current")} />
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 z-10 p-2 sm:p-2.5 flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] sm:text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--v-text-2)] truncate">{providerName}</p>
            <p className="mt-0.5 text-[12px] sm:text-[13px] font-bold leading-[1.2] text-white line-clamp-2">{game.gameNameEn}</p>
          </div>
          <span className="hidden md:grid shrink-0 w-7 h-7 rounded-full place-items-center bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 motion-reduce:transition-none">
            <Play className="w-3 h-3 fill-current ml-0.5" />
          </span>
        </div>
      </div>

      {showLogin && <LoginPrompt gameName={game.gameNameEn} onClose={() => setShowLogin(false)} />}
    </>
  );
}
