"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { GameCard } from "./GameCard";
import type { Game } from "@/types/games";

interface GameGridProps {
  games: Game[];
}

export function GameGrid({ games }: GameGridProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? games.filter((g) => g.gameNameEn.toLowerCase().includes(search.toLowerCase()))
    : games;

  return (
    <div>
      {/* Search within category */}
      <div className="relative mb-5 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-9 pl-9 pr-8 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/40 transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-zinc-500 text-sm">No games found</div>
      ) : (
        <>
          <p className="text-zinc-600 text-xs mb-3">{filtered.length} games</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3">
            {filtered.map((game) => (
              <GameCard key={game.gameID} game={game} className="w-full" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
