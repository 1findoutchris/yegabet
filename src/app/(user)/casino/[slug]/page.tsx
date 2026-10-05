import { notFound, redirect } from "next/navigation";
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
  getSectionGames,
  catalogMode,
  loadGames,
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
  live:  () => getLiveCasinoGames(catalogMode() === "octhera" ? 100_000 : 500),
  table: () => getSectionGames("casino", "table"),
};

// The Octhera catalog's Casino tabs list every game; the legacy ones kept the 500 cap.
const ALL = 100_000;
const OCTHERA_GETTERS: Record<string, () => ReturnType<typeof getHotGames>> = {
  slots: () => getSlotGames(ALL),
  hot:   () => getHotGames(ALL),
  new:   () => getNewGames(ALL),
};

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  // Crash & instant games are in the Games section now.
  if (slug === "crash" && catalogMode() === "octhera") redirect("/games?tab=crash");
  await loadGames();

  // Built-in category
  const getter = (catalogMode() === "octhera" && OCTHERA_GETTERS[slug]) || CATEGORY_GETTERS[slug];
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
  const games = getGamesByProvider(slug, catalogMode() === "octhera" ? ALL : 500);
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
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16">
      <header className="mb-6 sm:mb-8 v-fade-up">
        <Link
          href="/casino"
          className="inline-flex items-center gap-1 h-8 pl-1.5 pr-3 -ml-1.5 rounded-full text-[12px] font-semibold text-[color:var(--v-text-3)] hover:text-white hover:bg-[var(--v-bg-2)] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Casino
        </Link>
        <div className="mt-3 flex items-end gap-4">
          <div className="min-w-0">
            <p className="v-eyebrow text-[color:var(--v-teal)]">{theme.tag}</p>
            <h1 className="mt-1.5 text-[length:var(--v-fs-page)] font-extrabold tracking-[-0.03em] leading-none text-white truncate">
              {title}
            </h1>
            <p className="mt-2 text-[14px] text-[color:var(--v-text-3)]">{theme.description}</p>
          </div>
          <span className="ml-auto shrink-0 text-right">
            <span className="block text-[22px] font-extrabold text-white tabular-nums leading-none">{count.toLocaleString()}</span>
            <span className="text-[11px] font-semibold text-[color:var(--v-text-3)] uppercase tracking-[0.1em]">games</span>
          </span>
        </div>
        <div className="mt-5 h-px bg-[linear-gradient(90deg,var(--v-teal),rgba(25,211,197,0)_40%)] opacity-60" />
      </header>

      {children}
    </div>
  );
}
