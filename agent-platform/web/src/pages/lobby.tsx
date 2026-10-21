import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { useLoad } from "../ui";
import {
  CategoryTiles,
  GameCarousel,
  GameGrid,
  ProviderTiles,
  type CategoryTile,
  type Game,
  type ProviderTileData,
} from "../vinna/games";

/*
 * The player lobby in the old YegaBet layout (src/app/(user)/casino/page.tsx):
 * search, category tiles, then the rows top to bottom, providers last. Sports,
 * Rewards/XP, cashback and promos aren't on the new platform (plan 12).
 */

interface Lobby {
  counts: Record<string, number>;
  providers: ProviderTileData[];
  rows: Record<"popular" | "crash" | "slots" | "live" | "new" | "table", Game[]>;
}

const LABEL: Record<string, string> = {
  slots: "Slots",
  live: "Live Casino",
  table: "Table Games",
  crash: "Crash & Instant",
  fishing: "Fishing",
  lottery: "Lottery & Keno",
  arcade: "Arcade",
  other: "More Games",
  popular: "Popular",
  new: "New",
};

const useLobby = () => useLoad(() => api<Lobby>("/games/lobby"));

function Empty({ error }: { error?: string | null }) {
  return (
    <p className="text-[14px] text-[color:var(--v-text-3)] py-10 text-center">
      {error ?? "Games are loading. Please check back in a minute."}
    </p>
  );
}

const SearchBar = () => (
  <a
    href="#/search"
    className="flex items-center gap-2.5 h-11 px-4 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)] text-[14px] text-[color:var(--v-text-3)] hover:border-[color:var(--v-line-2)] transition-colors"
  >
    <Search className="w-4 h-4" /> Search games, providers or categories
  </a>
);

export function LobbyPage() {
  const { data, error } = useLobby();
  if (!data) return <Empty error={error} />;
  const c = data.counts;
  const tiles: CategoryTile[] = [
    { id: "slots", label: "Slots", icon: "slots", href: "#/c/slots", count: c.slots },
    { id: "live", label: "Live Casino", icon: "live", href: "#/c/live", count: c.live },
    { id: "table", label: "Table Games", icon: "table", href: "#/c/table", count: c.table },
    { id: "crash", label: "Crash", icon: "crash", href: "#/games/crash", count: c.crash },
    {
      id: "hot",
      label: "Popular",
      icon: "popular",
      href: "#/c/popular",
      count: data.rows.popular.length ? undefined : 0,
    },
    { id: "new", label: "New", icon: "new", href: "#/c/new", count: data.rows.new.length ? undefined : 0 },
  ].filter((t) => t.count !== 0);
  const r = data.rows;
  const nothing = Object.values(r).every((rows) => rows.length === 0);

  return (
    <div className="flex flex-col gap-7 sm:gap-10">
      <div className="flex flex-col gap-3">
        <SearchBar />
        {!nothing && <CategoryTiles tiles={tiles} label="Casino categories" />}
      </div>
      {nothing && <Empty />}
      <GameGrid
        title="Popular now"
        description="Most played by YegaBet players this month"
        games={r.popular}
        href="#/c/popular"
        eager={6}
        tag="hot"
      />
      <GameCarousel
        title="Crash games"
        description="Cash out before it flies"
        games={r.crash}
        href="#/games/crash"
        eager={r.popular.length ? 0 : 6}
      />
      <GameGrid title="Slots" games={r.slots} href="#/c/slots" />
      {r.live.length > 0 && (
        <div className="sm:rounded-[22px] sm:bg-[var(--v-bg-1)] sm:border sm:border-[color:var(--v-line)] sm:p-6 sm:overflow-hidden">
          <GameCarousel
            title="Live casino"
            description="Real dealers, streamed live"
            games={r.live}
            href="#/c/live"
            tag="live"
          />
        </div>
      )}
      <GameCarousel
        title="New in the lobby"
        description="Recently added games"
        games={r.new}
        href="#/c/new"
        tag="new"
      />
      <GameGrid
        title="Table games"
        description="Blackjack, roulette, baccarat and more"
        games={r.table}
        href="#/c/table"
      />
      <ProviderTiles title="Providers" description="Studios in the casino" providers={data.providers} />
    </div>
  );
}

/** Paged list of games for a filter (category / provider / search). */
function GameList({ query, title, description }: { query: string; title: string; description?: string }) {
  const [page, setPage] = useState(1);
  const [more, setMore] = useState<Game[]>([]);
  const first = useLoad(() => api<{ total: number; games: Game[] }>(`/games?${query}&page=1`), [query]);
  if (!first.data) return <Empty error={first.error} />;
  const games = [...first.data.games, ...more];
  const loadMore = async () => {
    const next = await api<{ games: Game[] }>(`/games?${query}&page=${page + 1}`);
    setMore((m) => [...m, ...next.games]);
    setPage(page + 1);
  };
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-bold text-white">{title}</h1>
        <p className="text-[13px] text-[color:var(--v-text-3)]">
          {description ?? `${first.data.total.toLocaleString()} games`}
        </p>
      </div>
      {games.length === 0 ? <Empty error="No games here yet." /> : <GameGrid games={games} all eager={12} />}
      {games.length < first.data.total && (
        <button
          onClick={loadMore}
          className="mx-auto h-10 px-6 rounded-full text-[13px] font-bold bg-[var(--v-bg-2)] border border-[color:var(--v-line)] text-white hover:border-[color:var(--v-line-2)]"
        >
          Show more
        </button>
      )}
    </div>
  );
}

/** #/c/<category>: a casino category, or the lobby's Popular / New rows in full. */
export function CategoryPage({ category }: { category: string }) {
  const lobby = useLobby();
  if (category === "popular" || category === "new") {
    if (!lobby.data) return <Empty error={lobby.error} />;
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[22px] font-bold text-white">{LABEL[category]}</h1>
        <GameGrid games={lobby.data.rows[category]} all eager={12} tag={category === "new" ? "new" : "hot"} />
      </div>
    );
  }
  return <GameList query={`category=${encodeURIComponent(category)}`} title={LABEL[category] ?? category} />;
}

const GAME_TABS = ["crash", "fishing", "lottery", "arcade", "other"];

/** #/games[/<category>]: the Games section with its tabs, as on the old site. */
export function GamesPage({ category }: { category?: string }) {
  const lobby = useLobby();
  const active = category && GAME_TABS.includes(category) ? category : "crash";
  const tabs = GAME_TABS.filter((t) => t === active || (lobby.data?.counts[t] ?? 0) > 0);
  return (
    <div className="flex flex-col gap-5">
      <ul className="v-rail">
        {tabs.map((t) => (
          <li key={t} className="shrink-0">
            <a
              href={`#/games/${t}`}
              className={
                "h-9 px-4 grid place-items-center rounded-full text-[13px] font-semibold border transition-colors " +
                (t === active
                  ? "bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] border-[color:var(--v-teal)]"
                  : "bg-[var(--v-bg-2)] text-[color:var(--v-text-2)] border-[color:var(--v-line)]")
              }
            >
              {LABEL[t]}
              {lobby.data && <span className="ml-1.5 opacity-70 tabular-nums">{lobby.data.counts[t]}</span>}
            </a>
          </li>
        ))}
      </ul>
      <GameList query={`category=${active}`} title={LABEL[active] as string} />
    </div>
  );
}

/** #/p/<slug>: one provider's games. */
export function ProviderPage({ slug }: { slug: string }) {
  const lobby = useLobby();
  const name = lobby.data?.providers.find((p) => p.slug === slug)?.name ?? slug;
  return <GameList query={`provider=${encodeURIComponent(slug)}`} title={name} />;
}

export function SearchPage() {
  const [q, setQ] = useState("");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 h-11 px-4 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)]">
        <Search className="w-4 h-4 text-[color:var(--v-text-3)]" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search games"
          className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-[color:var(--v-text-3)]"
        />
      </div>
      {q.trim().length >= 2 ? (
        <GameList query={`search=${encodeURIComponent(q.trim())}`} title={`Results for "${q.trim()}"`} />
      ) : (
        <p className="text-[13px] text-[color:var(--v-text-3)]">Type at least two letters.</p>
      )}
    </div>
  );
}
