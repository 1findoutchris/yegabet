"use client";

import { useEffect, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { GameCard } from "./GameCard";
import type { Game } from "@/types/games";

/**
 * Lobby game search.
 *
 * Searches the whole catalogue through /api/games/search rather than filtering
 * a list held in the page — the lobby only ever renders a few dozen curated
 * games, so an in-page filter would quietly search 1% of what's playable. (The
 * category pages DO filter in place, and correctly: there the list on screen is
 * the entire category.)
 *
 * Results push the rails below them down rather than replacing the page, so
 * clearing the field always returns the lobby exactly as it was.
 */
export function GameSearch({ placeholder = "Search games…" }: { placeholder?: string }) {
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<Game[] | null>(null);
  const [loading, setLoading] = useState(false);

  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) { setGames(null); setLoading(false); return; }

    // Debounced, and every in-flight request is abandoned when the next
    // keystroke lands — without this, results from "boo" can arrive after
    // "book" and overwrite them.
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/games/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { games: [] }))
        .then((d: { games: Game[] }) => { setGames(d.games); setLoading(false); })
        .catch(() => { if (!controller.signal.aborted) { setGames([]); setLoading(false); } });
    }, 250);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [term]);

  return (
    <section>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
        <input
          type="search"
          inputMode="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search games"
          className="w-full h-11 pl-9 pr-9 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {term.length >= 2 && (
        <div className="mt-4">
          {loading && games === null ? (
            <div className="flex items-center gap-2 text-[13px] text-[color:var(--text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          ) : games && games.length === 0 ? (
            <p className="text-[13px] text-[color:var(--text-muted)] py-6">
              No games match &ldquo;{term}&rdquo;.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[color:var(--text-muted)] mb-3">
                {games?.length}
                {games?.length === 24 ? "+" : ""} result{games?.length === 1 ? "" : "s"}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3">
                {games?.map((g) => (
                  <GameCard key={g.gameID} game={g} className="w-full" />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
