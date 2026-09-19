import { ArtChip } from "./MyCasinoArt";

/* VinnaBet-branded route loading state — a spinning chip, a shimmering
   wordmark, bouncing dots, and a few skeleton rails underneath. */
export function VinnaLoader() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="min-h-[58vh] flex flex-col items-center justify-center gap-5">
        <div className="vinna-spin drop-shadow-[0_6px_16px_rgba(192,122,255,0.45)]">
          <ArtChip className="w-16 h-16" />
        </div>

        <div className="font-display text-[30px] sm:text-[36px] font-extrabold tracking-[-0.04em] leading-none">
          <span className="vinna-shimmer">Vinna</span>
          <span className="vinna-shimmer-gold">Bet</span>
        </div>

        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="vinna-dot w-2 h-2 rounded-full bg-[var(--gold)]"
              style={{ animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </div>

        <p className="text-[12px] text-[color:var(--text-muted)] tracking-wide">Shuffling the deck…</p>
      </div>

      {/* skeleton rails */}
      <div className="space-y-6 opacity-70" aria-hidden>
        {[0, 1].map((row) => (
          <div key={row}>
            <div className="vinna-skeleton h-4 w-40 rounded-md mb-4" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="vinna-skeleton rounded-2xl shrink-0 w-[120px] sm:w-[150px] aspect-[3/4]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
