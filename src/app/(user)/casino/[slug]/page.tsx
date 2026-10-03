import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CategoryBrowser } from "@/components/casino/CategoryBrowser";
import {
  getHotGames,
  getNewGames,
  getSlotGames,
  getCrashGames,
  getLiveCasinoGames,
  getGamesByProvider,
  loadOctheraGames,
} from "@/lib/games";
import { PROVIDER_META } from "@/types/games";
import {
  CATEGORY_THEMES,
  DEFAULT_THEME,
  SUBCATEGORIES,
  type CategoryTheme,
} from "@/components/casino/categoryThemes";

const CATEGORY_GETTERS: Record<string, () => ReturnType<typeof getHotGames>> = {
  hot:   () => getHotGames(500),
  new:   () => getNewGames(500),
  slots: () => getSlotGames(500),
  crash: () => getCrashGames(500),
  live:  () => getLiveCasinoGames(500),
};

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  await loadOctheraGames();

  // Built-in category
  const getter = CATEGORY_GETTERS[slug];
  if (getter) {
    const games = getter();
    // Same rule as provider pages below: an empty category 404s rather
    // than rendering a themed page with "No games found".
    if (!games.length) notFound();
    const theme = CATEGORY_THEMES[slug] ?? DEFAULT_THEME;
    const subcats = SUBCATEGORIES[slug] ?? [];
    return (
      <ThemedPage theme={theme} title={theme.title} count={games.length}>
        <CategoryBrowser games={games} subcats={subcats} accent={theme.accent} />
      </ThemedPage>
    );
  }

  // Provider page (e.g. /casino/pgsoft, /casino/cq9)
  const games = getGamesByProvider(slug, 500);
  if (!games.length) notFound();
  const providerName = PROVIDER_META[slug]?.name ?? games[0].providerName;

  return (
    <ThemedPage
      theme={DEFAULT_THEME}
      title={providerName ?? slug.toUpperCase()}
      count={games.length}
    >
      <CategoryBrowser games={games} subcats={SUBCATEGORIES.default} accent={DEFAULT_THEME.accent} />
    </ThemedPage>
  );
}

function ThemedPage({
  theme,
  title,
  count,
  children,
}: {
  theme: CategoryTheme;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const { Art } = theme;
  return (
    <div className="relative">
      {/* Page background bloom — tinted to the category colour */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] -z-0"
        style={{
          background: `radial-gradient(900px 360px at 30% -10%, ${theme.tint}, transparent 70%)`,
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Themed hero banner */}
        <div
          className="relative overflow-hidden rounded-3xl mb-7 px-6 sm:px-8 py-7 sm:py-9 border border-white/15"
          style={{
            background: theme.grad,
            boxShadow: `0 18px 44px rgba(0,0,0,0.45), 0 0 40px ${theme.glow}`,
          }}
        >
          {/* sheen */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-16 -left-10 w-64 h-64 rounded-full"
            style={{ background: "radial-gradient(circle,rgba(255,255,255,0.4),transparent 65%)", opacity: 0.5 }}
          />
          {/* hero artwork */}
          <Art className="pointer-events-none absolute -bottom-4 right-2 sm:right-8 w-[120px] sm:w-[150px] drop-shadow-[0_6px_12px_rgba(0,0,0,0.4)]" />

          <div className="relative z-10">
            <Link
              href="/casino"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-white/80 hover:text-white transition-colors mb-3"
            >
              <ChevronLeft className="w-4 h-4" /> Back to lobby
            </Link>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">
              {theme.tag}
            </p>
            <h1 className="font-display text-[28px] sm:text-[38px] font-extrabold tracking-[-0.02em] leading-none text-white mt-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
              {title}
            </h1>
            <span className="inline-block mt-3 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1 text-[12px] font-bold text-white tabular-nums">
              {count} games
            </span>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
