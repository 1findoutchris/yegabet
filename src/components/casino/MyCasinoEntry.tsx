import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ArtMyCasino } from "./MyCasinoArt";

/* Gamified portal button into the personal "My Casino" page.
   Sits just above the All Games rails on the lobby. */
export function MyCasinoEntry() {
  return (
    <Link
      href="/my-casino"
      className="mc-entry group relative overflow-hidden rounded-2xl border border-[color:var(--border-royal)] flex items-center gap-3 sm:gap-5 p-4 sm:p-5"
      style={{ background: "linear-gradient(110deg,#1E1633 0%,#171022 45%,#140E1D 100%)" }}
    >
      {/* decorative blooms */}
      <span aria-hidden className="pointer-events-none absolute -top-16 left-16 w-56 h-56 rounded-full"
        style={{ background: "radial-gradient(circle,rgba(139,92,246,0.22),transparent 65%)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 right-24 w-56 h-56 rounded-full"
        style={{ background: "radial-gradient(circle,rgba(245,180,0,0.14),transparent 65%)" }} />

      {/* custom artwork */}
      <ArtMyCasino className="relative z-10 w-[92px] sm:w-[120px] shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2" />

      {/* copy */}
      <div className="relative z-10 min-w-0">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-royal-dim)] border border-[color:var(--border-royal)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--purple-2)]">
          ★ Player Hub
        </span>
        <h3 className="font-display text-[19px] sm:text-[24px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)] leading-tight mt-2">
          My Casino
        </h3>
        <p className="text-[12px] sm:text-[13px] text-[color:var(--text-secondary)] mt-0.5 truncate">
          Your big wins, rewards &amp; favourites — all in one place
        </p>
      </div>

      {/* CTA */}
      <span className="relative z-10 ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-royal-grad text-white px-3.5 sm:px-4 py-2 sm:py-2.5 text-[12px] sm:text-[13px] font-bold transition-transform group-hover:scale-[1.04]">
        <span className="hidden sm:inline">Enter</span>
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
