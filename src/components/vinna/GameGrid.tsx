"use client";

import { GameCard, type GameTag } from "./GameCard";
import { SectionHeader } from "./SectionHeader";
import type { Game } from "@/types/games";

/**
 * A compact two-row grid of game cards — the lobby's alternative to a
 * carousel. Columns follow the screen (3 on phones, 4 on small tablets, 5 on
 * tablets, 6–8 on desktop) and only two rows' worth of cards are shown at each
 * width; "View all" opens the full category.
 *
 * Cards past two rows are hidden with CSS per breakpoint (.v-grid2 in
 * tokens.css) rather than trimmed in JS, so server and client agree.
 */
export function GameGrid({
  title,
  description,
  games,
  href,
  tag,
  eager = 0,
  shape = "portrait",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  games: Game[];
  href?: string;
  tag?: GameTag;
  eager?: number;
  /** "wide": landscape cards in fewer columns (2 · 3 · 3 · 4 · 4). */
  shape?: "portrait" | "wide";
}) {
  if (!games.length) return null;
  return (
    <section className="cv-auto">
      <SectionHeader title={title} description={description} href={href} />
      <div className={shape === "wide" ? "v-grid2 v-grid2-wide" : "v-grid2"}>
        {/* One wrapper per card: GameCard can render its login prompt as a
            sibling, which must not shift the row counting above. */}
        {games.slice(0, 16).map((g, i) => (
          <div key={g.gameID} className="min-w-0">
            <GameCard game={g} tag={tag} eager={i < eager} shape={shape} />
          </div>
        ))}
      </div>
    </section>
  );
}
