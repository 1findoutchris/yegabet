"use client";

import { useMemo, useState } from "react";
import { Search, X, Layers } from "lucide-react";
import { GameCard } from "./GameCard";
import { SUBCAT_ICONS } from "./SubcategoryArt";
import type { SubCat } from "./categoryThemes";
import type { Game } from "@/types/games";
import { PROVIDER_META } from "@/types/games";
import { CATEGORY_LABEL, type Category } from "@/lib/catalogClassify";
import { cn } from "@/lib/utils";

interface Props {
  games: Game[];
  subcats: SubCat[];
  accent: string; // solid hex
  /** Show the provider filter when the set has more than one provider (default on). */
  providerFilter?: boolean;
}

const PAGE = 60;

const providerOf = (g: Game) => PROVIDER_META[g.provider]?.name ?? g.providerName ?? g.provider;

function matches(game: Game, keywords: string[]): boolean {
  const n = game.gameNameEn.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

export function CategoryBrowser({ games, subcats, accent, providerFilter = true }: Props) {
  const [active, setActive] = useState("all");
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [type, setType] = useState("");
  // Sections hold thousands of games — render a page at a time.
  const [shown, setShown] = useState(PAGE);
  const filterKey = `${active}|${search}|${provider}|${type}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) { setLastKey(filterKey); setShown(PAGE); }

  // Providers in this set, biggest first — the "classify by provider" filter.
  const providers = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const g of games) {
      const p = counts.get(g.provider) ?? { name: providerOf(g), count: 0 };
      p.count++;
      counts.set(g.provider, p);
    }
    return [...counts.entries()]
      .map(([slug, p]) => ({ slug, ...p }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [games]);

  // Game types in this set (Octhera's catalog) — only shown when it mixes
  // several, e.g. a provider page with slots and live tables.
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of games) if (g.category) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    return [...counts.entries()].map(([id, count]) => ({
      id, count, label: CATEGORY_LABEL[id as Category] ?? id,
    }));
  }, [games]);

  // Only keep sub-categories that actually have games in this set.
  const available = useMemo(
    () =>
      subcats
        .map((s) => ({ ...s, count: games.filter((g) => matches(g, s.keywords)).length }))
        .filter((s) => s.count > 0),
    [subcats, games]
  );

  const activeSub = available.find((s) => s.id === active);
  const q = search.trim().toLowerCase();
  const filtered = games.filter((g) =>
    (!activeSub || matches(g, activeSub.keywords)) &&
    (!provider || g.provider === provider) &&
    (!type || g.category === type) &&
    (!q || g.gameNameEn.toLowerCase().includes(q))
  );

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

      {/* Type pills — only when this set mixes game types */}
      {types.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          {[{ id: "", label: "All types", count: games.length }, ...types].map((t) => (
            <button
              key={t.id || "all"}
              onClick={() => setType(t.id)}
              className={cn(
                "whitespace-nowrap px-3.5 py-[6px] rounded-lg text-[12px] transition-colors",
                type === t.id
                  ? "bg-[var(--bg-accent-dim)] border border-[color:var(--gold)] text-[color:var(--gold)] font-semibold"
                  : "bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-medium hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]"
              )}
            >
              {t.label} <span className="tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search + provider filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search games…"
            aria-label="Search games"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-8 rounded-lg bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-sm placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {providerFilter && providers.length > 1 && (
          <div className="relative w-full sm:w-60">
            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--gold)] pointer-events-none" />
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              aria-label="Filter by provider"
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:border-[color:var(--border-accent)] transition-colors appearance-none"
            >
              <option value="">All providers ({providers.length})</option>
              {providers.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name} ({p.count})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-[color:var(--text-muted)] text-sm">No games found</div>
      ) : (
        <>
          <p className="text-[color:var(--text-muted)] text-xs mb-3">{filtered.length} games</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3">
            {filtered.slice(0, shown).map((game) => (
              <GameCard key={game.gameID} game={game} className="w-full" />
            ))}
          </div>
          {filtered.length > shown && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => setShown((n) => n + PAGE * 2)}
                className="h-10 px-6 rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] text-[13px] font-semibold text-[color:var(--text-primary)] transition-colors"
              >
                Show more <span className="text-[color:var(--text-muted)] tabular-nums">({filtered.length - shown} left)</span>
              </button>
            </div>
          )}
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
