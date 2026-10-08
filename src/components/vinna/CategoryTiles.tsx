import Link from "next/link";
import { CATEGORY_ART } from "./CategoryArt";

export interface CategoryTile {
  id: string;
  label: string;
  /** Key into CATEGORY_ART. */
  icon: string;
  href: string;
  /** Real number of games behind the tile; left out when unknown. */
  count?: number;
}

/**
 * Illustrated category tiles: artwork, name and game count. A swipeable row
 * on phones, a single wrapped row from tablet up. Only pass categories that
 * have games — empty ones would lead to an empty page.
 */
export function CategoryTiles({ tiles, label = "Categories" }: { tiles: CategoryTile[]; label?: string }) {
  if (!tiles.length) return null;
  return (
    <nav aria-label={label}>
      <ul className="v-rail md:!mx-0 md:!px-0 md:flex-wrap md:overflow-visible">
        {tiles.map((t) => {
          const Art = CATEGORY_ART[t.icon] ?? CATEGORY_ART.all;
          return (
            <li key={t.id} className="shrink-0">
              <Link
                href={t.href}
                className="v-press group relative flex flex-col items-center justify-center gap-1.5 w-[78px] sm:w-[96px] h-[96px] sm:h-[104px] rounded-[18px] overflow-hidden bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:border-[color:var(--v-teal-a24)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)]"
              >
                <span aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,var(--v-teal-a12),transparent_70%)]" />
                <Art className="relative w-11 h-11 sm:w-12 sm:h-12 transition-transform duration-200 md:group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:md:group-hover:scale-100" />
                <span className="relative px-1 text-center text-[11.5px] sm:text-[12px] font-bold leading-tight text-white line-clamp-2">{t.label}</span>
                {typeof t.count === "number" && (
                  <span className="relative -mt-1 text-[10px] font-semibold tabular-nums text-[color:var(--v-text-3)]">{t.count.toLocaleString()}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
