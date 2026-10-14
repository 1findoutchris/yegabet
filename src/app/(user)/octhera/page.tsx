import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { CategoryBrowser } from "@/components/casino/CategoryBrowser";
import { DEFAULT_THEME, SUBCATEGORIES } from "@/components/casino/categoryThemes";
import { catalogMode, loadOctheraPage } from "@/lib/games";

export const metadata: Metadata = {
  title: "Octhera Games",
  alternates: { canonical: "/octhera" },
};

/*
 * /octhera — Octhera's catalog IS the site's catalog now, organized into
 * Casino / Sports / Games, so this sends players to the lobby. It stays a
 * valid URL because it's the Lobby URL set in Octhera's portal (where a
 * game's exit button goes). With GAME_CATALOG=legacy it is the old page:
 * every game on our Octhera account, for everyone. Tapping one
 * launches it through Octhera (/api/games/launch, game_uid octhera:<gameUid>).
 * On whenever OCTHERA_API_KEY is set; OCTHERA_PAGE=off hides it (404).
 * The games play with the player's normal YegaBet balance.
 */
export default async function OctheraPage() {
  if (catalogMode() === "octhera") redirect("/casino");
  const { on, games, error } = await loadOctheraPage();
  if (!on) notFound();

  const theme = DEFAULT_THEME;
  const subcats = [...SUBCATEGORIES.crash, ...SUBCATEGORIES.default];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16">
        <header className="mb-6 sm:mb-8">
          <Link
            href="/casino"
            className="inline-flex items-center gap-1 h-8 pl-1.5 pr-3 -ml-1.5 rounded-full text-[12px] font-semibold text-[color:var(--v-text-3)] hover:text-white hover:bg-[var(--v-bg-2)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Casino
          </Link>
          <p className="mt-3 v-eyebrow text-[color:var(--v-teal)]">All games</p>
          <h1 className="mt-1.5 text-[length:var(--v-fs-page)] font-extrabold tracking-[-0.03em] leading-none text-white">Octhera Games</h1>
          <p className="mt-2 text-[14px] text-[color:var(--v-text-3)] tabular-nums">{games.length} games</p>
        </header>

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
  );
}
