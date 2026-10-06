"use client";

import { X } from "lucide-react";
import { VMark } from "@/components/vinna/VMark";
import { LaunchOverlay } from "@/components/vinna/LaunchOverlay";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { PROVIDER_META } from "@/types/games";
import { useNativeBack } from "@/hooks/useNativeBack";

export function GamePlayer() {
  const { current, gameUrl, status, close } = useGamePlayer();
  useNativeBack(!!current, close);

  if (!current) return null;

  const providerName = PROVIDER_META[current.provider]?.name ?? current.providerName ?? current.provider;

  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-3 sm:px-4 bg-[var(--v-bg-1)] border-b border-[color:var(--v-line)] shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)", minHeight: 48 }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <VMark size={26} />
          <div className="min-w-0 leading-tight">
            <p className="text-white font-bold text-[14px] truncate">{current.gameNameEn}</p>
            <p className="text-[color:var(--v-text-3)] text-[11px] font-semibold uppercase tracking-[0.08em] truncate">{providerName}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={close}
            className="w-9 h-9 grid place-items-center rounded-full bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-black">
        {status === "loading" && (
          <LaunchOverlay name={current.gameNameEn} provider={providerName} />
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
