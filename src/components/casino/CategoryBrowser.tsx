"use client";

import { useMemo, useState } from "react";
import { Search, X, Layers } from "lucide-react";
import { GameCard } from "./GameCard";
import { SUBCAT_ICONS } from "./SubcategoryArt";
import type { SubCat } from "./categoryThemes";
import type { Game } from "@/types/games";
import { PROVIDER_META } from "@/types/games";
import { CATEGORY_LABEL, type Category } from "@/lib/catalogClassify";
import { groupOf, type GameGroup } from "@/lib/gameGroups";

interface Props {
  games: Game[];
  subcats: SubCat[];
  /** Kept for callers; the redesign uses the VinnaBet accent everywhere. */
  accent?: string;
  /** Show the provider filter when the set has more than one provider (default on). */
  providerFilter?: boolean;
  /** Provider-type groups (lib/gameGroups) — used instead of `subcats` when given. */
  groups?: GameGroup[];
  /** Pre-selected sub-category / group and provider, e.g. from a lobby tile. */
  initialSub?: string;
  initialProvider?: string;
  initialType?: string;
}

const PAGE = 60;

const providerOf = (g: Game) => PROVIDER_META[g.provider]?.name ?? g.providerName ?? g.provider;

function matches(game: Game, keywords: string[]): boolean {
  const n = game.gameNameEn.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

export function CategoryBrowser({ games, subcats, providerFilter = true, groups, initialSub, initialProvider, initialType }: Props) {
  const [active, setActive] = useState(initialSub || "all");
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState(initialProvider ?? "");
  const [type, setType] = useState(initialType ?? "");
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

  // Only keep sub-categories that actually have games in this set. With
  // `groups`, each game sits in exactly one group (provider type first).
  const groupIds = useMemo(
    () => (groups ? new Map(games.map((g) => [g.gameID, groupOf(g, groups)])) : null),
    [groups, games]
  );
  const inSub = (g: Game, s: { id: string; keywords: string[] }) =>
    groupIds ? groupIds.get(g.gameID) === s.id : matches(g, s.keywords);
  const available = useMemo(
    () =>
      (groups ?? subcats)
        .map((s) => ({ ...s, count: games.filter((g) => (groupIds ? groupIds.get(g.gameID) === s.id : matches(g, s.keywords))).length }))
        .filter((s) => s.count > 0),
    [groups, subcats, games, groupIds]
  );

  const activeSub = available.find((s) => s.id === active);
  const q = search.trim().toLowerCase();
  const filtered = games.filter((g) =>
    (!activeSub || inSub(g, activeSub)) &&
    (!provider || g.provider === provider) &&
    (!type || g.category === type) &&
    (!q || g.gameNameEn.toLowerCase().includes(q))
  );

  const AllIcon = SUBCAT_ICONS.all;

  return (
    <div>
      {/* Sub-category pills */}
      {available.length > 0 && (
        <div className="v-rail gap-2 mb-4 py-0.5">
          <button data-active={active === "all"} onClick={() => setActive("all")} className="v-pill shrink-0">
            <AllIcon className="w-4 h-4" /> All
          </button>
          {available.map((s) => {
            const Icon = SUBCAT_ICONS[s.icon] ?? SUBCAT_ICONS[s.id] ?? AllIcon;
            return (
              <button key={s.id} data-active={active === s.id} onClick={() => setActive(s.id)} className="v-pill shrink-0">
                <Icon className="w-4 h-4" /> {s.label}
                <span className="text-[11px] tabular-nums opacity-60">{s.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Type pills — only when this set mixes game types */}
      {types.length > 1 && (
        <div className="v-rail gap-2 mb-4 py-0.5">
          {[{ id: "", label: "All types", count: games.length }, ...types].map((t) => (
            <button
              key={t.id || "all"}
              onClick={() => setType(t.id)}
              data-active={type === t.id}
              className="v-pill shrink-0 h-8 text-[12px]"
            >
              {t.label} <span className="tabular-nums opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search + provider filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search games…"
            aria-label="Search games"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-11 pl-10 pr-9 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] text-white text-[14px] placeholder:text-[color:var(--v-text-3)] focus:outline-none focus:border-[color:var(--v-teal)] transition-colors"
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
            <Layers className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[color:var(--gold)] pointer-events-none" />
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              aria-label="Filter by provider"
              className="w-full h-11 pl-9 pr-4 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] text-white text-[14px] focus:outline-none focus:border-[color:var(--v-teal)] transition-colors appearance-none"
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
        <div className="py-16 text-center">
          <p className="text-[15px] font-semibold text-white">No games found</p>
          <p className="mt-1 text-[13px] text-[color:var(--v-text-3)]">Try another filter or search term.</p>
        </div>
      ) : (
        <>
          <p className="v-eyebrow mb-3 tabular-nums">{filtered.length.toLocaleString()} games</p>
          <div className="grid grid-cols-2 min-[540px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filtered.slice(0, shown).map((game) => (
              <GameCard key={game.gameID} game={game} className="w-full" />
            ))}
          </div>
          {filtered.length > shown && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => setShown((n) => n + PAGE * 2)}
                className="v-btn v-btn-ghost rounded-full px-6"
              >
                Show more <span className="text-[color:var(--v-text-3)] tabular-nums">{(filtered.length - shown).toLocaleString()} left</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
