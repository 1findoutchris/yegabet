import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { CategoryBrowser } from "@/components/casino/CategoryBrowser";
import { DEFAULT_THEME, SUBCATEGORIES } from "@/components/casino/categoryThemes";
import { loadOctheraPage } from "@/lib/games";

export const metadata: Metadata = {
  title: "Octhera Games",
  alternates: { canonical: "/octhera" },
};

/*
 * /octhera — every game on our Octhera account, for everyone. Tapping one
 * launches it through Octhera (/api/games/launch, game_uid octhera:<gameUid>).
 * On whenever OCTHERA_API_KEY is set; OCTHERA_PAGE=off hides it (404).
 * The games play with the player's normal VinnaBet balance.
 */
export default async function OctheraPage() {
  const { on, games, error } = await loadOctheraPage();
  if (!on) notFound();

  const theme = DEFAULT_THEME;
  const subcats = [...SUBCATEGORIES.crash, ...SUBCATEGORIES.default];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] -z-0"
        style={{ background: `radial-gradient(900px 360px at 30% -10%, ${theme.tint}, transparent 70%)` }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div
          className="relative overflow-hidden rounded-3xl mb-7 px-6 sm:px-8 py-7 sm:py-9 border border-white/15"
          style={{ background: theme.grad, boxShadow: `0 18px 44px rgba(0,0,0,0.45), 0 0 40px ${theme.glow}` }}
        >
          <theme.Art className="pointer-events-none absolute -bottom-4 right-2 sm:right-8 w-[120px] sm:w-[150px] drop-shadow-[0_6px_12px_rgba(0,0,0,0.4)]" />
          <div className="relative z-10">
            <Link
              href="/casino"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-white/80 hover:text-white transition-colors mb-3"
            >
              <ChevronLeft className="w-4 h-4" /> Back to lobby
            </Link>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/75">All games</p>
            <h1 className="font-display text-[28px] sm:text-[38px] font-extrabold tracking-[-0.02em] leading-none text-white mt-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
              Octhera Games
            </h1>
            <span className="inline-block mt-3 rounded-full bg-black/25 backdrop-blur-sm px-3 py-1 text-[12px] font-bold text-white tabular-nums">
              {games.length} games
            </span>
          </div>
        </div>

        {games.length > 0 ? (
          <CategoryBrowser games={games} subcats={subcats} accent={theme.accent} />
        ) : (
          <div className="rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)] px-5 py-10 text-center">
            <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">
              {error ? "Octhera games aren't available right now." : "Loading Octhera's games — refresh in a minute."}
            </p>
            {error && <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">Reason: {error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
