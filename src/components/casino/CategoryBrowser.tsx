"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { GameCard } from "./GameCard";
import { SUBCAT_ICONS } from "./SubcategoryArt";
import type { SubCat } from "./categoryThemes";
import type { Game } from "@/types/games";
import { cn } from "@/lib/utils";

interface Props {
  games: Game[];
  subcats: SubCat[];
  accent: string; // solid hex
}

function matches(game: Game, keywords: string[]): boolean {
  const n = game.gameNameEn.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

export function CategoryBrowser({ games, subcats, accent }: Props) {
  const [active, setActive] = useState("all");
  const [search, setSearch] = useState("");

  // Only keep sub-categories that actually have games in this set.
  const available = useMemo(
    () =>
      subcats
        .map((s) => ({ ...s, count: games.filter((g) => matches(g, s.keywords)).length }))
        .filter((s) => s.count > 0),
    [subcats, games]
  );

  const activeSub = available.find((s) => s.id === active);
  const base = activeSub ? games.filter((g) => matches(g, activeSub.keywords)) : games;
  const filtered = search.trim()
    ? base.filter((g) => g.gameNameEn.toLowerCase().includes(search.toLowerCase()))
    : base;

  const AllIcon = SUBCAT_ICONS.all;

  return (
    <div>
      {/* Sub-category tiles */}
      {available.length > 0 && (
        <div className="flex flex-nowrap sm:flex-wrap gap-x-5 gap-y-4 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
          <SubTile
            label="All"
            icon={<AllIcon className="w-6 h-6" />}
            active={active === "all"}
            accent={accent}
            onClick={() => setActive("all")}
          />
          {available.map((s) => {
            const Icon = SUBCAT_ICONS[s.icon] ?? AllIcon;
            return (
              <SubTile
                key={s.id}
                label={s.label}
                icon={<Icon className="w-6 h-6" />}
                active={active === s.id}
                accent={accent}
                onClick={() => setActive(s.id)}
              />
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
        <input
          type="text"
          placeholder="Search games…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-9 pl-9 pr-8 rounded-lg bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-sm placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-[color:var(--text-muted)] text-sm">No games found</div>
      ) : (
        <>
          <p className="text-[color:var(--text-muted)] text-xs mb-3">{filtered.length} games</p>
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

function SubTile({
  label, icon, active, accent, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group shrink-0 flex flex-col items-center gap-1.5 w-[60px] text-center transition-transform duration-150 hover:-translate-y-0.5"
    >
      {/* Logo — colour-tinted in the category accent */}
      <span
        className="transition-colors"
        style={{ color: active ? accent : "var(--text-secondary)" }}
      >
        {icon}
      </span>

      <span
        className={cn(
          "text-[11px] font-semibold leading-tight line-clamp-2",
          active ? "" : "text-[color:var(--text-secondary)] group-hover:text-[color:var(--text-primary)]"
        )}
        style={active ? { color: accent } : undefined}
      >
        {label}
      </span>
    </button>
  );
}
