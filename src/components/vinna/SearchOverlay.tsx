"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Search, X, Clock, TrendingUp, Layers, LayoutGrid, Loader2 } from "lucide-react";
import { GameCard } from "./GameCard";
import { SkeletonGrid } from "./Skeleton";
import type { Game } from "@/types/games";

/** Fire this anywhere to open the search overlay mounted in the header. */
export const OPEN_SEARCH_EVENT = "vinna:open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

const RECENT_KEY = "vinna:recent-searches";
const CATEGORIES = [
  { label: "Slots", href: "/casino/slots" },
  { label: "Live Casino", href: "/casino/live" },
  { label: "Crash & Instant", href: "/games?tab=crash" },
  { label: "Table Games", href: "/casino/table" },
  { label: "New Games", href: "/casino/new" },
  { label: "Popular", href: "/casino/hot" },
];

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 8); } catch { return []; }
}
function writeRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* private mode */ }
}

/**
 * Full-screen search: recent searches, trending games, then live results from
 * the whole catalogue (/api/games/search) plus matching providers and
 * categories. Closes itself when a result navigates away.
 */
export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) { setLastPath(pathname); if (open) setOpen(false); }

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
  }, []);

  if (!open || typeof document === "undefined") return null;
  return createPortal(<SearchPanel onClose={() => setOpen(false)} />, document.body);
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<Game[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [trending, setTrending] = useState<{ games: Game[]; providers: { slug: string; name: string; count: number }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games/trending")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setTrending(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Same debounce + abort as the lobby field, so a slow "boo" can't land after "book".
  useEffect(() => {
    if (term.length < 2) { setGames(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/games/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { games: [] }))
        .then((d: { games: Game[] }) => { setGames(d.games); setLoading(false); })
        .catch(() => { if (!controller.signal.aborted) { setGames([]); setLoading(false); } });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term]);

  const remember = useCallback((q: string) => {
    const v = q.trim();
    if (v.length < 2) return;
    setRecent((prev) => {
      const next = [v, ...prev.filter((p) => p.toLowerCase() !== v.toLowerCase())].slice(0, 8);
      writeRecent(next);
      return next;
    });
  }, []);

  const lc = term.toLowerCase();
  const providerHits = useMemo(
    () => (term.length >= 2 ? (trending?.providers ?? []).filter((p) => p.name.toLowerCase().includes(lc)).slice(0, 6) : []),
    [trending, term, lc]
  );
  const categoryHits = term.length >= 2 ? CATEGORIES.filter((c) => c.label.toLowerCase().includes(lc)) : [];

  return (
    <div className="fixed inset-0 z-[90] bg-[var(--v-bg-1)] v-fade-in flex flex-col" role="dialog" aria-modal="true" aria-label="Search">
      <div className="shrink-0 border-b border-[color:var(--v-line)] pt-[env(safe-area-inset-top)]">
        <form
          onSubmit={(e) => { e.preventDefault(); remember(term); inputRef.current?.blur(); }}
          className="max-w-3xl mx-auto flex items-center gap-2 h-16 px-3 sm:px-6"
        >
          <button type="button" onClick={onClose} aria-label="Close search" className="w-10 h-10 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--v-text-3)] pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games, providers or categories"
              aria-label="Search games, providers or categories"
              className="w-full h-11 pl-10 pr-10 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] text-[15px] text-white placeholder:text-[color:var(--v-text-3)] focus:outline-none focus:border-[color:var(--v-teal)] transition-colors"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-[color:var(--v-text-3)] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 pb-[calc(24px+env(safe-area-inset-bottom))]">
          {term.length < 2 ? (
            <>
              {recent.length > 0 && (
                <section className="mb-7">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="v-eyebrow flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Recent</h3>
                    <button onClick={() => { setRecent([]); writeRecent([]); }} className="text-[12px] font-semibold text-[color:var(--v-text-3)] hover:text-white">Clear</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button key={r} onClick={() => setQuery(r)} className="v-pill">{r}</button>
                    ))}
                  </div>
                </section>
              )}

              <section className="mb-7">
                <h3 className="v-eyebrow flex items-center gap-1.5 mb-3"><LayoutGrid className="w-3.5 h-3.5" /> Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => <Link key={c.href} href={c.href} className="v-pill">{c.label}</Link>)}
                </div>
              </section>

              <section>
                <h3 className="v-eyebrow flex items-center gap-1.5 mb-3"><TrendingUp className="w-3.5 h-3.5" /> Trending</h3>
                {trending === null ? (
                  <SkeletonGrid count={6} />
                ) : trending.games.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {trending.games.slice(0, 5).map((g) => (
                        <button key={g.gameID} onClick={() => setQuery(g.gameNameEn)} className="v-pill">
                          <TrendingUp className="w-3.5 h-3.5 text-[color:var(--v-teal)]" /> {g.gameNameEn}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {trending.games.slice(0, 8).map((g) => <GameCard key={g.gameID} game={g} tag="trending" />)}
                    </div>
                  </>
                ) : null}
              </section>
            </>
          ) : (
            <div onClickCapture={() => remember(term)}>
              {(providerHits.length > 0 || categoryHits.length > 0) && (
                <section className="mb-6">
                  <div className="flex flex-wrap gap-2">
                    {categoryHits.map((c) => (
                      <Link key={c.href} href={c.href} className="v-pill"><LayoutGrid className="w-3.5 h-3.5 text-[color:var(--v-teal)]" /> {c.label}</Link>
                    ))}
                    {providerHits.map((p) => (
                      <Link key={p.slug} href={`/casino/${p.slug}`} className="v-pill">
                        <Layers className="w-3.5 h-3.5 text-[color:var(--v-teal)]" /> {p.name}
                        <span className="text-[11px] text-[color:var(--v-text-3)] tabular-nums">{p.count}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {loading && games === null ? (
                <SkeletonGrid count={8} />
              ) : games && games.length === 0 ? (
                <p className="text-[14px] text-[color:var(--v-text-3)] py-10 text-center">No games match &ldquo;{term}&rdquo;.</p>
              ) : (
                <>
                  <p className="text-[12px] text-[color:var(--v-text-3)] mb-3 flex items-center gap-2">
                    {games?.length}{games?.length === 24 ? "+" : ""} game{games?.length === 1 ? "" : "s"}
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {games?.map((g) => <GameCard key={g.gameID} game={g} />)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
