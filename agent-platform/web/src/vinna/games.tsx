import { createContext, useContext, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { CATEGORY_ART } from "./CategoryArt";
import { cn } from "./cn";

/*
 * The old YegaBet lobby components (src/components/vinna), ported to the new
 * platform: same markup and Tailwind classes, with Next.js links/images
 * swapped for plain <a href="#/…"> and <img>, and playing a game going
 * through the new API.
 */

export interface Game {
  gameUid: string;
  name: string;
  providerName: string | null;
  providerSlug: string | null;
  category: string;
  img: string | null;
}

/** How a card starts a game (set by the lobby: login first, then launch). */
const PlayCtx = createContext<(g: Game) => void>(() => undefined);
export const PlayProvider = ({ play, children }: { play: (g: Game) => void; children: ReactNode }) => (
  <PlayCtx.Provider value={play}>{children}</PlayCtx.Provider>
);

export type GameTag = "hot" | "new" | "live";
const TAGS: Record<GameTag, { label: string; dot: string; pulse?: boolean }> = {
  hot: { label: "Hot", dot: "var(--v-amber)" },
  new: { label: "New", dot: "var(--v-teal)" },
  live: { label: "Live", dot: "var(--v-red)", pulse: true },
};

function initials(name: string): string {
  const w = name.split(/[\s_-]+/).filter(Boolean);
  return (w.length >= 2 ? (w[0] as string)[0]! + (w[1] as string)[0]! : name.slice(0, 2)).toUpperCase();
}

const BOX_RATIO = { portrait: 4 / 5, wide: 16 / 10 };

/** The old site's game card: artwork in a rounded box, name, provider below, a small tag top-left. */
export function GameCard({
  game,
  tag,
  className,
  eager = false,
  shape = "portrait",
}: {
  game: Game;
  tag?: GameTag;
  className?: string;
  eager?: boolean;
  shape?: "portrait" | "wide";
}) {
  const play = useContext(PlayCtx);
  const [imgError, setImgError] = useState(!game.img);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const providerName = game.providerName ?? "";

  function onLoad(e: SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    const off = w / h / BOX_RATIO[shape];
    setFit(off > 1.3 || off < 0.77 ? "contain" : "cover");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play ${game.name} by ${providerName}`}
      onClick={() => play(game)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play(game);
        }
      }}
      className={cn(
        "group relative shrink-0 select-none cursor-pointer rounded-[16px]",
        "transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        "active:scale-[0.97] md:hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)]",
        className,
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[16px] bg-[var(--v-bg-2)] ring-1 ring-[color:var(--v-line)]",
          "transition-shadow duration-[220ms] md:group-hover:shadow-[var(--v-ring)]",
          shape === "wide" ? "aspect-[16/10]" : "aspect-[4/5]",
        )}
      >
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#1C1C1C,#0A0A0A)]">
          <span className="absolute inset-0 grid place-items-center text-[32px] font-extrabold text-white/[0.06] tracking-tight">
            {initials(providerName || game.name)}
          </span>
        </div>
        {!imgError && game.img && fit === "contain" && (
          <img
            src={game.img}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-125 blur-xl opacity-60"
          />
        )}
        {!imgError && game.img && (
          <img
            src={game.img}
            alt={game.name}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onLoad={onLoad}
            onError={() => setImgError(true)}
            className={cn(
              "absolute inset-0 w-full h-full",
              fit === "contain" ? "object-contain" : "object-cover",
              "transition-transform duration-[400ms] ease-out md:group-hover:scale-[1.05]",
            )}
          />
        )}
        {tag && (
          <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 h-5 pl-1.5 pr-2 rounded-full v-glass text-[9px] font-bold uppercase tracking-[0.08em] text-white">
            <span
              className={cn("w-1.5 h-1.5 rounded-full", TAGS[tag].pulse && "animate-pulse")}
              style={{ background: TAGS[tag].dot }}
            />
            {TAGS[tag].label}
          </span>
        )}
        <span className="hidden md:grid absolute right-1.5 bottom-1.5 z-10 w-7 h-7 rounded-full place-items-center bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
          <Play className="w-3 h-3 fill-current ml-0.5" />
        </span>
      </div>
      <div className="pt-1.5 px-0.5 min-w-0">
        <p
          className="text-[12px] sm:text-[13px] font-bold leading-[1.25] text-white truncate"
          title={game.name}
        >
          {game.name}
        </p>
        <p className="mt-px text-[10.5px] sm:text-[11px] font-medium text-[color:var(--v-text-3)] truncate">
          {providerName}
        </p>
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  href,
  count,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-[length:var(--v-fs-section)] font-bold tracking-[-0.02em] text-white leading-tight">
          {title}
        </h2>
        {description && (
          <p className="text-[13px] text-[color:var(--v-text-3)] mt-1 truncate">{description}</p>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {actions}
        {href && (
          <a
            href={href}
            className="group inline-flex items-center gap-0.5 h-8 pl-3 pr-2 rounded-full text-[12px] font-semibold text-[color:var(--v-text-2)] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:text-white hover:border-[color:var(--v-line-2)] transition-colors"
          >
            View all
            {typeof count === "number" && (
              <span className="ml-1 text-[color:var(--v-text-3)] tabular-nums">{count}</span>
            )}
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/** A snap-scrolling row of cards with "View all" (arrows from tablet up). */
export function GameCarousel({
  title,
  description,
  games,
  href,
  tag,
  eager = 0,
}: {
  title: ReactNode;
  description?: ReactNode;
  games: Game[];
  href?: string;
  tag?: GameTag;
  eager?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (!games.length) return null;
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * 700, behavior: "smooth" });
  const arrows = (
    <div className="hidden md:flex gap-1.5">
      {([-1, 1] as const).map((d) => (
        <button
          key={d}
          onClick={() => scroll(d)}
          aria-label={d < 0 ? "Scroll left" : "Scroll right"}
          className="w-8 h-8 grid place-items-center rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)] text-[color:var(--v-text-2)] hover:text-white hover:border-[color:var(--v-line-2)] transition-colors"
        >
          {d < 0 ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      ))}
    </div>
  );
  return (
    <section className="cv-auto v-fade-up">
      <SectionHeader title={title} description={description} href={href} actions={arrows} />
      <div ref={ref} className="v-rail pb-1">
        {games.map((g, i) => (
          <GameCard
            key={g.gameUid}
            game={g}
            tag={tag}
            eager={i < eager}
            className="w-[29vw] max-w-[128px] sm:w-[136px] sm:max-w-none lg:w-[146px]"
          />
        ))}
      </div>
    </section>
  );
}

/** A compact two-row grid (columns follow the screen; extra cards hidden by .v-grid2). */
export function GameGrid({
  title,
  description,
  games,
  href,
  tag,
  eager = 0,
  all = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  games: Game[];
  href?: string;
  tag?: GameTag;
  eager?: number;
  /** Show every game (category pages) instead of two rows. */
  all?: boolean;
}) {
  if (!games.length) return null;
  return (
    <section className="cv-auto">
      {title && <SectionHeader title={title} description={description} href={href} />}
      <div
        className={all ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3" : "v-grid2"}
      >
        {(all ? games : games.slice(0, 16)).map((g, i) => (
          <div key={g.gameUid} className="min-w-0">
            <GameCard game={g} tag={tag} eager={i < eager} />
          </div>
        ))}
      </div>
    </section>
  );
}

export interface CategoryTile {
  id: string;
  label: string;
  icon: string;
  href: string;
  count?: number;
}

/** Illustrated category tiles with game counts (swipeable on phones). */
export function CategoryTiles({ tiles, label = "Categories" }: { tiles: CategoryTile[]; label?: string }) {
  if (!tiles.length) return null;
  return (
    <nav aria-label={label}>
      <ul className="v-rail md:!mx-0 md:!px-0 md:flex-wrap md:overflow-visible">
        {tiles.map((t) => {
          const Art = CATEGORY_ART[t.icon] ?? CATEGORY_ART.all;
          return (
            <li key={t.id} className="shrink-0">
              <a
                href={t.href}
                className="v-press group relative flex flex-col items-center justify-center gap-1.5 w-[78px] sm:w-[96px] h-[96px] sm:h-[104px] rounded-[18px] overflow-hidden bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:border-[color:var(--v-teal-a24)] transition-colors"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,var(--v-teal-a12),transparent_70%)]"
                />
                {Art && (
                  <Art className="relative w-11 h-11 sm:w-12 sm:h-12 transition-transform duration-200 md:group-hover:scale-[1.06]" />
                )}
                <span className="relative px-1 text-center text-[11.5px] sm:text-[12px] font-bold leading-tight text-white line-clamp-2">
                  {t.label}
                </span>
                {typeof t.count === "number" && (
                  <span className="relative -mt-1 text-[10px] font-semibold tabular-nums text-[color:var(--v-text-3)]">
                    {t.count.toLocaleString()}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface ProviderTileData {
  slug: string;
  name: string;
  count: number;
}

/** Provider panels: the name as clean text (no logo files yet) and the game count. */
export function ProviderTiles({
  title = "Providers",
  description,
  providers,
  limit = 12,
}: {
  title?: string;
  description?: string;
  providers: ProviderTileData[];
  limit?: number;
}) {
  if (providers.length < 2) return null;
  return (
    <section className="cv-auto">
      <SectionHeader title={title} description={description} />
      <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {providers.slice(0, limit).map((p) => (
          <li key={p.slug}>
            <a
              href={`#/p/${p.slug}`}
              aria-label={`${p.name}: ${p.count} games`}
              className="v-press group flex flex-col items-center justify-center gap-1 h-[72px] sm:h-[80px] px-3 rounded-[16px] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:border-[color:var(--v-line-2)] transition-colors"
            >
              <span className="max-w-full text-center text-[13px] sm:text-[14px] font-extrabold tracking-[-0.01em] text-white leading-tight line-clamp-2">
                {p.name}
              </span>
              <span className="text-[10.5px] font-semibold tabular-nums text-[color:var(--v-text-3)]">
                {p.count.toLocaleString()} games
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
