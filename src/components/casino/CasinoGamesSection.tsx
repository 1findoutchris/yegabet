"use client";

import { useState } from "react";
import { Flame, Sparkles, Gamepad2, Tv2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { GameRow } from "./GameRow";
import { ProviderSelect } from "./ProviderSelect";
import type { Game } from "@/types/games";

type Filter = "all" | "new" | "slots" | "live";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",   label: "All Games"   },
  { id: "slots", label: "Slots"       },
  { id: "live",  label: "Live Casino" },
  { id: "new",   label: "New Games"   },
];

interface Props {
  hotGames:  Game[];
  newGames:  Game[];
  slotGames: Game[];
  liveGames: Game[];
  pgGames:   Game[];
  providers: { slug: string; name: string; count: number }[];
}

export function CasinoGamesSection({
  hotGames, newGames, slotGames, liveGames, pgGames, providers,
}: Props) {
  const [active, setActive] = useState<Filter>("all");

  const show = (id: Filter) => active === "all" || active === id;

  return (
    <div id="games">
      {/* Filter pills + provider dropdown */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={cn(
                "whitespace-nowrap px-4 py-[7px] rounded-lg text-[12px] transition-all duration-150",
                active === f.id
                  ? "bg-[var(--bg-accent-dim)] border border-[color:var(--gold)] text-[color:var(--gold)] font-semibold"
                  : "bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-medium hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto pb-1">
          <ProviderSelect providers={providers} />
        </div>
      </div>

      {/* Game rows */}
      <div className="space-y-6">
        {active === "all" && hotGames.length > 0 && (
          <GameRow title="Popular Games" icon={<Flame className="w-[18px] h-[18px]" />}
            games={hotGames} accentColor="text-[color:var(--gold)]"
            viewAllHref="/casino/hot" badge="hot" />
        )}

        {show("new") && newGames.length > 0 && (
          <GameRow title="New Arrivals" icon={<Sparkles className="w-[18px] h-[18px]" />}
            games={newGames} accentColor="text-[color:var(--gold)]"
            viewAllHref="/casino/new" badge="new" />
        )}

        {show("slots") && slotGames.length > 0 && (
          <GameRow title="Slots" icon={<Zap className="w-[18px] h-[18px]" />}
            games={slotGames} accentColor="text-[color:var(--gold)]"
            viewAllHref="/casino/slots" />
        )}

        {show("live") && liveGames.length > 0 && (
          <GameRow title="Live Casino" icon={<Tv2 className="w-[18px] h-[18px]" />}
            games={liveGames} accentColor="text-[color:var(--gold)]"
            viewAllHref="/casino/live" badge="live" />
        )}

        {active === "all" && pgGames.length > 0 && (
          <GameRow title="PG Soft" icon={<Gamepad2 className="w-[18px] h-[18px]" />}
            games={pgGames} accentColor="text-[color:var(--gold)]"
            viewAllHref="/casino/pgsoft" />
        )}
      </div>
    </div>
  );
}
