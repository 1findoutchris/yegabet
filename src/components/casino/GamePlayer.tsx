"use client";

import { X, Loader2 } from "lucide-react";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { PROVIDER_META } from "@/types/games";

export function GamePlayer() {
  const { current, gameUrl, status, close } = useGamePlayer();

  if (!current) return null;

  const providerName = PROVIDER_META[current.provider]?.name ?? current.provider;

  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 bg-[#0C2027]/95 backdrop-blur-xl border-b border-[color:var(--border-muted)] shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)", minHeight: 48 }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display text-gold-grad font-bold text-sm shrink-0">Vinna</span>
          <span className="text-[color:var(--text-primary)] font-semibold text-sm truncate">{current.gameNameEn}</span>
          <span className="text-[color:var(--text-muted)] text-xs shrink-0">· {providerName}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={close}
            className="p-2.5 rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-black">
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
            <Loader2 className="w-9 h-9 text-[color:var(--gold)] animate-spin" />
            <p className="text-[color:var(--text-secondary)] text-sm">Loading {current.gameNameEn}…</p>
          </div>
        )}

        {status === "ready" && gameUrl && (
          <iframe
            src={gameUrl}
            className="w-full h-full border-0"
            allow="fullscreen; autoplay"
            title={current.gameNameEn}
          />
        )}

      </div>
    </div>
  );
}
