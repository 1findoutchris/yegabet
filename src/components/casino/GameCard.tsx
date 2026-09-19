"use client";

import Image from "next/image";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Game } from "@/types/games";
import { PROVIDER_META } from "@/types/games";
import { LoginPrompt } from "./LoginPrompt";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useFavorites } from "@/contexts/FavoritesContext";

// Deterministic gradient from provider slug
const GRADIENTS: [string, string][] = [
  ["#3b0764", "#581c87"],
  ["#1e1b4b", "#312e81"],
  ["#052e16", "#14532d"],
  ["#450a0a", "#7f1d1d"],
  ["#431407", "#7c2d12"],
  ["#0c4a6e", "#075985"],
  ["#2d1657", "#4c1d95"],
  ["#042f2e", "#134e4a"],
  ["#1a1a2e", "#16213e"],
  ["#3b0764", "#701a75"],
  ["#1c1917", "#292524"],
  ["#0f172a", "#1e293b"],
];

function providerGradient(slug: string): [string, string] {
  let h = 5381;
  for (const c of slug) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

function providerInitials(name: string): string {
  const w = name.split(/[\s_\-]+/);
  return w.length >= 2
    ? (w[0][0] + w[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export type GameBadge = "hot" | "new" | "live" | "jackpot";

interface GameCardProps {
  game: Game;
  className?: string;
  badge?: GameBadge;
}

// v2 badge palette — fixed hex chips per design spec
const BADGE_STYLES: Record<GameBadge, React.CSSProperties> = {
  hot:     { background: "#7C2D12", color: "#FCA5A5" },
  new:     { background: "#14532D", color: "#86EFAC" },
  live:    { background: "#7F1D1D", color: "#FCA5A5" },
  jackpot: { background: "#3B0764", color: "var(--purple)" },
};
const BADGE_LABELS: Record<GameBadge, string> = {
  hot: "HOT", new: "NEW", live: "LIVE", jackpot: "JACKPOT",
};

export function GameCard({ game, className, badge }: GameCardProps) {
  const { data: session } = useSession();
  const { open: openGame } = useGamePlayer();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const [imgError, setImgError] = useState(!game.img); // no img → skip straight to fallback
  const [hovered, setHovered] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const providerName = PROVIDER_META[game.provider]?.name ?? game.provider.toUpperCase();
  const [gradFrom, gradTo] = providerGradient(game.provider);
  const initials = providerInitials(providerName);
  const fav = isFavorite(game.gameID);

  function handlePlay() {
    if (!session) setShowLoginPrompt(true);
    else openGame(game);
  }

  return (
    <>
      <div
        className={cn(
          "group press relative rounded-2xl overflow-hidden cursor-pointer shrink-0 select-none",
          "bg-[var(--bg-surface)] border border-[color:var(--border-base)]",
          "transition-[border-color,transform,box-shadow] duration-200",
          "hover:border-[color:var(--border-accent)] hover:-translate-y-1",
          "hover:shadow-[0_12px_30px_rgba(0,0,0,0.5),0_0_22px_rgba(245,180,0,0.22)]",
          className
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handlePlay}
      >
        {/* Thumbnail */}
        <div className="relative w-full aspect-[3/4]">
          {/* Gradient fallback — always rendered, covered by image if loaded */}
          <div
            className="absolute inset-0 flex flex-col items-end justify-end p-2"
            style={{ background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` }}
          >
            {/* Large initials watermark */}
            <span
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-black text-white/10 select-none pointer-events-none"
              style={{ fontSize: "clamp(2.5rem, 6vw, 3.5rem)", lineHeight: 1 }}
            >
              {initials}
            </span>
            {/* Game name on the fallback */}
            {imgError && (
              <div className="relative z-10 w-full">
                <p className="text-white text-[11px] font-semibold leading-tight line-clamp-2">{game.gameNameEn}</p>
                <p className="text-white/40 text-[9px] mt-0.5">{providerName}</p>
              </div>
            )}
          </div>

          {/* Actual image — hides the fallback when loaded */}
          {!imgError && game.img && (
            <Image
              src={game.img}
              alt={game.gameNameEn}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105 relative z-10"
              onError={() => setImgError(true)}
              sizes="(max-width: 640px) 30vw, (max-width: 768px) 22vw, 185px"
              unoptimized
            />
          )}

          {/* Favorite heart — top-left, logged-in only */}
          {session && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(game.gameID); }}
              aria-label={fav ? `Remove ${game.gameNameEn} from favorites` : `Add ${game.gameNameEn} to favorites`}
              aria-pressed={fav}
              className={cn(
                "absolute top-2 left-2 z-30 w-7 h-7 rounded-full flex items-center justify-center transition-colors",
                "bg-black/45 backdrop-blur-sm hover:bg-black/65",
                fav ? "text-[color:var(--red)]" : "text-white/80 hover:text-white"
              )}
            >
              <Heart className={cn("w-4 h-4 transition-transform", fav && "fill-current scale-110")} />
            </button>
          )}

          {/* Badge — top-right */}
          {badge && (
            <div
              className="absolute top-2 right-2 z-20 text-[10px] font-bold px-1.5 py-0.5 rounded-md tracking-[0.06em] uppercase"
              style={BADGE_STYLES[badge]}
            >
              {BADGE_LABELS[badge]}
            </div>
          )}

          {/* Hover play overlay — CSS transitions, scale on inner button */}
          <div
            className={cn(
              "absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-200",
              hovered ? "opacity-100" : "opacity-0"
            )}
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); handlePlay(); }}
              aria-label={`Play ${game.gameNameEn}`}
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center bg-gold-grad glow-gold text-[#09090B] text-lg",
                "transition-transform duration-200",
                hovered ? "scale-100" : "scale-75"
              )}
            >
              ▶
            </button>
          </div>
        </div>

        {/* Info bar */}
        <div className="px-3 py-2.5 bg-[var(--bg-surface)] border-t border-[color:var(--border-muted)]">
          <p className="text-[13px] font-semibold text-[color:var(--text-primary)] truncate leading-tight">{game.gameNameEn}</p>
          <p className="text-[11px] text-[color:var(--text-muted)] truncate mt-0.5">{providerName}</p>
        </div>
      </div>

      {showLoginPrompt && (
        <LoginPrompt gameName={game.gameNameEn} onClose={() => setShowLoginPrompt(false)} />
      )}
    </>
  );
}
