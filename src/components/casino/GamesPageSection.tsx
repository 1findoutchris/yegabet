"use client";

import { useState } from "react";
import { Star, Rocket, Gamepad2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { GameGrid } from "./GameGrid";
import { GameRow } from "./GameRow";
import type { Game } from "@/types/games";

type Filter = "crash" | "slots" | "new";

const FILTERS: { id: Filter; label: string; icon: React.ElementType }[] = [
  { id: "crash", label: "Crash & Instant", icon: Rocket   },
  { id: "slots", label: "Slots",           icon: Gamepad2 },
  { id: "new",   label: "New Games",       icon: Sparkles },
];

interface Props {
  popularGames: Game[];
  crashGames:   Game[];
  slotGames:    Game[];
  newGames:     Game[];
}

export function GamesPageSection({ popularGames, crashGames, slotGames, newGames }: Props) {
  const [active, setActive] = useState<Filter>("crash");

  const gridGames =
    active === "crash" ? crashGames :
    active === "slots" ? slotGames  :
    newGames;

  return (
    <div className="space-y-8">
      {/* Popular games row — always visible */}
      {popularGames.length > 0 && (
        <GameRow
          title="Popular Games"
          icon={<Star className="w-5 h-5" />}
          games={popularGames}
          accentColor="text-amber-400"
          badge="hot"
        />
      )}

      {/* Category filter + full grid */}
      <div>
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-hide">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                active === id
                  ? "bg-amber-500 text-black"
                  : "border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <GameGrid games={gridGames} />
      </div>
    </div>
  );
}
