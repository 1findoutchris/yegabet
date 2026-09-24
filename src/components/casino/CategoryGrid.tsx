import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LOBBY_TILES } from "./categoryThemes";

interface Counts {
  all: number; slots: number; live: number; crash: number; new: number; hot: number;
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k+`;
  return `${n}+`;
}

const ART = "absolute -bottom-2 -right-1 w-[58%] max-w-[110px] drop-shadow-[0_4px_8px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3";

export function CategoryGrid({ counts }: { counts: Counts }) {
  return (
    <section>
      {/* Header */}
      <div className="flex items-end gap-3 mb-4">
        <div>
          <h2 className="font-display text-[20px] sm:text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">
            Browse the floor
          </h2>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Pick your game — {fmt(counts.all)} titles across every category
          </p>
        </div>
        <Link
          href="/games"
          className="ml-auto hidden sm:flex items-center gap-1 text-[12px] font-medium text-[color:var(--text-muted)] hover:text-[color:var(--gold)] transition-colors"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Vibrant category tiles with custom artwork */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {LOBBY_TILES.map((t, i) => {
          const count = counts[t.countKey];
          // A tile advertising "0+ games" is a dead end — hide it.
          if (count === 0) return null;
          return (
            <Link
              key={t.title}
              href={`/casino/${t.slug}`}
              className="cat-tile group press relative overflow-hidden rounded-2xl aspect-[4/3] sm:aspect-[5/6] p-3 flex flex-col justify-between select-none"
              style={{
                background: t.grad,
                // @ts-expect-error custom prop consumed in CSS
                "--cat-glow": t.glow,
                animationDelay: `${i * 45}ms`,
              }}
            >
              {/* top-left sheen */}
              <span
                aria-hidden
                className="pointer-events-none absolute -top-8 -left-6 w-28 h-28 rounded-full"
                style={{ background: "radial-gradient(circle,rgba(255,255,255,0.45),transparent 65%)", opacity: 0.55 }}
              />

              {/* hero artwork */}
              <t.Art className={ART} />

              {/* count pill */}
              <span className="relative z-10 self-start rounded-full bg-black/25 backdrop-blur-sm px-2 py-[3px] text-[10px] font-bold text-white tracking-wide tabular-nums">
                {fmt(count)}
              </span>

              {/* label */}
              <div className="relative z-10">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/75 leading-none">
                  {t.tag}
                </p>
                <p className="mt-1 font-display text-[15px] sm:text-[17px] font-extrabold leading-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
                  {t.title}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
