/* Custom artwork for the "My Casino" personalised section.
   ArtTreasure / ArtChip are full-colour hero illustrations; the Ic* glyphs are
   compact currentColor stat icons. */

type P = { className?: string };

/* ── Treasure / big-payout hero ────────────────────────────────────────────── */
export function ArtTreasure({ className }: P) {
  return (
    <svg viewBox="0 0 96 80" className={className} aria-hidden>
      <defs>
        <radialGradient id="tr-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="#FFE9A8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFE9A8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tr-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE07A" />
          <stop offset="50%" stopColor="#F5B400" />
          <stop offset="100%" stopColor="#C8860A" />
        </linearGradient>
        <linearGradient id="tr-coin2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD66B" />
          <stop offset="100%" stopColor="#D9970C" />
        </linearGradient>
        <linearGradient id="tr-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF4CC" />
          <stop offset="100%" stopColor="#E8A911" />
        </linearGradient>
      </defs>

      <ellipse cx="48" cy="58" rx="44" ry="18" fill="url(#tr-glow)" />

      {/* back coin stacks */}
      <g>
        <ellipse cx="24" cy="48" rx="13" ry="5" fill="url(#tr-coin2)" />
        <rect x="11" y="40" width="26" height="8" rx="2" fill="url(#tr-coin)" />
        <ellipse cx="24" cy="40" rx="13" ry="5" fill="url(#tr-rim)" />
      </g>
      <g>
        <ellipse cx="72" cy="50" rx="12" ry="4.6" fill="url(#tr-coin2)" />
        <rect x="60" y="43" width="24" height="7" rx="2" fill="url(#tr-coin)" />
        <ellipse cx="72" cy="43" rx="12" ry="4.6" fill="url(#tr-rim)" />
      </g>

      {/* big front coin with star */}
      <circle cx="48" cy="46" r="18" fill="url(#tr-coin)" stroke="#B7790A" strokeWidth="1.5" />
      <circle cx="48" cy="46" r="13.5" fill="none" stroke="#FFF4CC" strokeWidth="1.6" opacity="0.7" />
      <path
        d="M48 37l2.7 5.5 6 .9-4.4 4.2 1 6L48 51l-5.3 2.6 1-6L39.3 43.4l6-.9L48 37Z"
        fill="#FFFBEB"
      />
      <ellipse cx="42" cy="40" rx="3.5" ry="2" fill="#fff" opacity="0.55" transform="rotate(-30 42 40)" />

      {/* scattered coins + sparkles */}
      <circle cx="84" cy="24" r="5" fill="url(#tr-coin2)" stroke="#B7790A" strokeWidth="1" />
      <circle cx="14" cy="22" r="4" fill="url(#tr-coin2)" stroke="#B7790A" strokeWidth="1" />
      <path d="M70 12l1.4 3.4 3.4 1.4-3.4 1.4L70 23l-1.4-3.4L65.2 18l3.4-1.4L70 12Z" fill="#FFD66B" />
      <path d="M30 8l1 2.5 2.5 1-2.5 1L30 16l-1-2.5L26.5 12.5l2.5-1L30 8Z" fill="#FFE9A8" />
      <circle cx="58" cy="16" r="1.6" fill="#FFF4CC" />
    </svg>
  );
}

/* ── Poker-chip emblem (section header) ────────────────────────────────────── */
export function ArtChip({ className }: P) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="chip-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="url(#chip-g)" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const r = (a * Math.PI) / 180;
        const x = 24 + Math.cos(r) * 21;
        const y = 24 + Math.sin(r) * 21;
        return (
          <rect key={a} x={x - 3} y={y - 2} width="6" height="4" rx="1.2"
            fill="#FBBF24" transform={`rotate(${a} ${x} ${y})`} />
        );
      })}
      <circle cx="24" cy="24" r="14" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="3 3" opacity="0.55" />
      <path d="M24 14l2.6 5.3 5.8.8-4.2 4.1 1 5.8L24 27.3l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L24 14Z" fill="#FBBF24" />
    </svg>
  );
}

/* ── "My Casino" portal emblem (section entry button) ──────────────────────── */
export function ArtMyCasino({ className }: P) {
  return (
    <svg viewBox="0 0 96 64" className={className} aria-hidden>
      <defs>
        <radialGradient id="mc-glow" cx="58%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mc-chip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B69BFF" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="mc-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE07A" />
          <stop offset="55%" stopColor="#F5B400" />
          <stop offset="100%" stopColor="#C8860A" />
        </linearGradient>
        <linearGradient id="mc-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF4CC" />
          <stop offset="100%" stopColor="#E8A911" />
        </linearGradient>
      </defs>

      <ellipse cx="52" cy="40" rx="44" ry="22" fill="url(#mc-glow)" />

      {/* gold coin stack behind */}
      <g>
        <ellipse cx="24" cy="44" rx="14" ry="5.2" fill="#D9970C" />
        <rect x="10" y="34" width="28" height="10" rx="2.4" fill="url(#mc-coin)" />
        <ellipse cx="24" cy="34" rx="14" ry="5.2" fill="url(#mc-rim)" />
        <path d="M24 28.5l1.7 3.4 3.8.5-2.8 2.6.7 3.7L24 37l-3.4 1.7.7-3.7-2.8-2.6 3.8-.5L24 28.5Z" fill="#FFFBEB" />
      </g>

      {/* purple poker chip */}
      <g transform="rotate(-8 60 34)">
        <circle cx="60" cy="34" r="22" fill="url(#mc-chip)" stroke="#4C1D95" strokeWidth="1.5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const r = (a * Math.PI) / 180;
          const x = 60 + Math.cos(r) * 22;
          const y = 34 + Math.sin(r) * 22;
          return (
            <rect key={a} x={x - 3.2} y={y - 2.2} width="6.4" height="4.4" rx="1.3"
              fill="#FBBF24" transform={`rotate(${a} ${x} ${y})`} />
          );
        })}
        <circle cx="60" cy="34" r="15" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeDasharray="3.2 3.2" opacity="0.6" />
        <path d="M60 23l3 6.1 6.7.9-4.9 4.7 1.2 6.7L60 43l-6 3.1 1.2-6.7L50.3 30l6.7-.9L60 23Z" fill="#FBBF24" />
      </g>

      {/* sparkles */}
      <path d="M86 12l1.5 3.6 3.6 1.5-3.6 1.5L86 23.8l-1.5-3.6-3.6-1.5 3.6-1.5L86 12Z" fill="#FFD66B" />
      <circle cx="40" cy="12" r="1.7" fill="#C4B5FD" />
      <circle cx="80" cy="46" r="1.6" fill="#FFE9A8" />
    </svg>
  );
}

/* ── Compact stat glyphs (currentColor) ────────────────────────────────────── */
const base = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export function IcTrophy({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M12 13v3M9 20h6M10 16h4l-.5 4h-3L10 16Z" />
    </svg>
  );
}

export function IcCoins({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <ellipse cx="9" cy="7" rx="5.5" ry="3" />
      <path d="M3.5 7v4c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3V7" />
      <path d="M9.5 14.2v3c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4c0-1.5-1.9-2.7-4.5-3" />
    </svg>
  );
}

export function IcStreak({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M13 2c.5 3 3.5 4.8 3.5 8.2 0 1-.3 1.9-.8 2.6.9-.2 1.7-.9 2.1-1.9 1.2 1.6 1.7 3.3 1.7 4.9A7.5 7.5 0 0 1 4.5 16c0-2.6 1.4-4.4 2.8-5.8.3 1 .9 1.7 1.8 2C8.4 9.6 10.7 6.7 13 2Z" />
    </svg>
  );
}

export function IcLevel({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 21l-4.9 2.7.9-5.5-4-3.9 5.5-.8L12 3Z" />
    </svg>
  );
}
