"use client";

import { useState } from "react";
import { Star, Rocket, Gamepad2, Sparkles, Fish, Ticket, Joystick } from "lucide-react";
import { CategoryTabs } from "@/components/vinna/CategoryTabs";
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
          title="Popular right now"
          description="Crash and instant favourites"
          icon={<Star className="w-5 h-5" />}
          games={popularGames}
          badge="hot"
        />
      )}

      {/* Category tabs + full grid */}
      {active && (
        <div>
          <CategoryTabs
            className="mb-5"
            label="Game types"
            active={active.id}
            onSelect={pick}
            tabs={tabs.map(({ id, label, games }) => {
              const Icon = ICONS[id] ?? Gamepad2;
              return { id, label, count: games.length, icon: <Icon className="w-4 h-4" /> };
            })}
          />

          <CategoryBrowser
            key={active.id}
            games={active.games}
            subcats={active.id === "crash" ? SUBCATEGORIES.crash : active.id === "slots" || active.id === "new" ? SUBCATEGORIES.default : []}
          />
        </div>
      )}
    </div>
  );
}
