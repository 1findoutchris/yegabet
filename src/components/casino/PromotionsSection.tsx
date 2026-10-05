import Link from "next/link";
import { Gift, RefreshCw, Percent, Sparkles, ArrowUpRight } from "lucide-react";
import { SectionHeader } from "@/components/vinna/SectionHeader";

export interface Promo {
  id: string;
  /** Legacy field from the old card; the redesign uses an icon per promo id. */
  emoji: string;
  title: string;
  /** Display copy, e.g. "20% bonus up to ETB 500". */
  desc: string;
  href: string;
  cta: string;
}

const ICONS: Record<string, typeof Gift> = { welcome: Gift, reload: RefreshCw, cashback: Percent };

/**
 * Live promotions. Every card is built from real config by the caller, so this
 * renders nothing rather than advertising an offer that doesn't exist.
 */
export function PromotionsSection({ promos }: { promos: Promo[] }) {
  if (promos.length === 0) return null;

  return (
    <section>
      <SectionHeader title="Offers" description="Live bonuses on your account" />
      <div className="v-rail">
        {promos.map((p) => {
          const Icon = ICONS[p.id] ?? Sparkles;
          return (
            <Link
              key={p.id}
              href={p.href}
              className="group shrink-0 w-[280px] sm:w-[320px] flex gap-4 p-4 rounded-[18px] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:border-[color:var(--border-royal)] transition-colors"
            >
              <span className="shrink-0 w-11 h-11 rounded-[14px] grid place-items-center bg-[var(--v-amber-a12)] text-[color:var(--v-amber)]">
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-white">{p.title}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--v-text-2)] line-clamp-2">{p.desc}</p>
                <p className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-bold text-[color:var(--v-amber)]">
                  {p.cta} <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
