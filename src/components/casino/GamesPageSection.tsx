"use client";

import { useState } from "react";
import { Star, Rocket, Gamepad2, Sparkles, Fish, Ticket, Joystick } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryBrowser } from "./CategoryBrowser";
import { GameRow } from "./GameRow";
import { SUBCATEGORIES } from "./categoryThemes";
import type { Game } from "@/types/games";

export interface GamesTab {
  id: string;
  label: string;
  games: Game[];
}

const ICONS: Record<string, React.ElementType> = {
  crash: Rocket, fishing: Fish, lottery: Ticket, arcade: Joystick, slots: Gamepad2, new: Sparkles,
};

interface Props {
  popularGames: Game[];
  /** Only tabs with games — the server leaves out empty ones. */
  tabs: GamesTab[];
  /** ?tab= from the URL (e.g. the lobby's Crash & Instant tile). */
  initialTab?: string;
}

export function GamesPageSection({ popularGames, tabs, initialTab }: Props) {
  const [selected, setSelected] = useState<string | undefined>(initialTab);
  const active = tabs.find((t) => t.id === selected) ?? tabs[0];

  function pick(id: string) {
    setSelected(id);
    // Keep the tab in the URL so back/refresh/share land on it.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }

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

      {/* Category tabs + full grid */}
      {active && (
        <div>
          <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            {tabs.map(({ id, label, games }) => {
              const Icon = ICONS[id] ?? Gamepad2;
              return (
                <button
                  key={id}
                  onClick={() => pick(id)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                    active.id === id
                      ? "bg-amber-500 text-black"
                      : "border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  <span className="tabular-nums opacity-70">{games.length}</span>
                </button>
              );
            })}
          </div>

          <CategoryBrowser
            key={active.id}
            games={active.games}
            subcats={active.id === "crash" ? SUBCATEGORIES.crash : active.id === "slots" || active.id === "new" ? SUBCATEGORIES.default : []}
            accent="#F59E0B"
          />
        </div>
      )}
    </div>
  );
}
