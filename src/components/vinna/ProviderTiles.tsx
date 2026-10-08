import Link from "next/link";
import { SectionHeader } from "./SectionHeader";
import { providerLogo } from "@/lib/providerLogos";

export interface ProviderTileData {
  slug: string;
  name: string;
  /** Games from this provider on the current page's catalog. */
  count: number;
}

/**
 * Provider panels: the official logo when one is in public/providers (kept at
 * its own proportions), otherwise the name as text. Each opens that
 * provider's games, pre-filtered to this page's category via `query`.
 */
export function ProviderTiles({
  title = "Providers",
  description,
  providers,
  query = "",
  limit = 12,
}: {
  title?: string;
  description?: string;
  providers: ProviderTileData[];
  /** Appended to /casino/<slug>, e.g. "?type=live". */
  query?: string;
  limit?: number;
}) {
  if (providers.length < 2) return null;
  return (
    <section className="cv-auto">
      <SectionHeader title={title} description={description} />
      <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {providers.slice(0, limit).map((p) => {
          const logo = providerLogo(p.slug);
          return (
            <li key={p.slug}>
              <Link
                href={`/casino/${p.slug}${query}`}
                aria-label={`${p.name} — ${p.count} games`}
                className="v-press group flex flex-col items-center justify-center gap-1 h-[72px] sm:h-[80px] px-3 rounded-[16px] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:border-[color:var(--v-line-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)]"
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small static logo, own proportions
                  <img src={logo} alt="" loading="lazy" decoding="async" className="max-h-7 sm:max-h-8 max-w-full w-auto object-contain" />
                ) : (
                  <span className="max-w-full text-center text-[13px] sm:text-[14px] font-extrabold tracking-[-0.01em] text-white leading-tight line-clamp-2">{p.name}</span>
                )}
                <span className="text-[10.5px] font-semibold tabular-nums text-[color:var(--v-text-3)]">{p.count.toLocaleString()} games</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
