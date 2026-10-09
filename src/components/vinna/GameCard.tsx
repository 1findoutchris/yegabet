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
  /** Artwork box: portrait 4:5 (default) or wide 16:10 for landscape table art. */
  shape?: "portrait" | "wide";
}

const BOX_RATIO = { portrait: 4 / 5, wide: 16 / 10 };

/**
 * VinnaBet game card: the artwork in a rounded box, the game name below it
 * and the provider, smaller and muted, under that. A small glass tag sits
 * top-left and the favourite (saved to the player's account) top-right.
 * Artwork whose shape is far from the box's is shown whole over a blurred
 * copy of itself rather than cropped. Opening a game goes through
 * GamePlayerContext exactly as before (Octhera → /game/[id], other providers
 * → overlay player).
 */
export function GameCard({ game, tag, badge, className, eager = false, shape = "portrait" }: Props) {
  const { data: session } = useSession();
  const { open: openGame } = useGamePlayer();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const [imgError, setImgError] = useState(!game.img);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [showLogin, setShowLogin] = useState(false);
  const [favTick, setFavTick] = useState(0);

  const providerName = PROVIDER_META[game.provider]?.name ?? game.providerName ?? game.provider.toUpperCase();
  const fav = isFavorite(game.gameID);
  const t = tag ?? badge;

  function play() {
    if (!session) setShowLogin(true);
    else openGame(game);
  }

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    const off = (w / h) / BOX_RATIO[shape];
    setFit(off > 1.3 || off < 0.77 ? "contain" : "cover");
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
          "group relative shrink-0 select-none cursor-pointer rounded-[16px]",
          "transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          "active:scale-[0.97] md:hover:-translate-y-0.5",
          "motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:md:hover:translate-y-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--v-bg-0)]",
          className
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-[16px] bg-[var(--v-bg-2)] ring-1 ring-[color:var(--v-line)]",
            "transition-shadow duration-[220ms] md:group-hover:shadow-[var(--v-ring)]",
            shape === "wide" ? "aspect-[16/10]" : "aspect-[4/5]",
          )}
        >
          {/* Fallback art: always under the image */}
          <div className="absolute inset-0 bg-[linear-gradient(160deg,#15233B,#0A1222)]">
            <span className="absolute inset-0 grid place-items-center text-[32px] font-extrabold text-white/[0.06] tracking-tight">
              {initials(providerName)}
            </span>
          </div>

          {!imgError && game.img && fit === "contain" && (
            <Image src={game.img} alt="" aria-hidden fill unoptimized className="object-cover scale-125 blur-xl opacity-60" />
          )}
          {!imgError && game.img && (
            <Image
              src={game.img}
              alt={game.gameNameEn}
              fill
              unoptimized
              priority={eager}
              onLoad={onLoad}
              onError={() => setImgError(true)}
              sizes="(max-width: 640px) 31vw, (max-width: 1024px) 20vw, 150px"
              className={cn(
                fit === "contain" ? "object-contain" : "object-cover",
                "transition-transform duration-[400ms] ease-out md:group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:md:group-hover:scale-100",
              )}
            />
          )}

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

          <span className="hidden md:grid absolute right-1.5 bottom-1.5 z-10 w-7 h-7 rounded-full place-items-center bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 motion-reduce:transition-none">
            <Play className="w-3 h-3 fill-current ml-0.5" />
          </span>
        </div>

        <div className="pt-1.5 px-0.5 min-w-0">
          <p className="text-[12px] sm:text-[13px] font-bold leading-[1.25] text-white truncate" title={game.gameNameEn}>{game.gameNameEn}</p>
          <p className="mt-px text-[10.5px] sm:text-[11px] font-medium text-[color:var(--v-text-3)] truncate">{providerName}</p>
        </div>
      </div>

      {showLogin && <LoginPrompt gameName={game.gameNameEn} onClose={() => setShowLogin(false)} />}
    </>
  );
}
