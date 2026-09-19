/* Hand-built casino category artwork.
   Glossy, multi-colour SVG illustrations — crisp at any size, each with its own
   namespaced gradient ids so multiples can share a page without id collisions.
   Designed to read on a coloured tile: bold fills, white highlights, soft shadow. */

type ArtProps = { className?: string };

const shadow = (
  <ellipse cx="32" cy="57" rx="20" ry="4.2" fill="rgba(0,0,0,0.28)" />
);

/* ── Slots → glossy cherries ───────────────────────────────────────────────── */
export function ArtCherries({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id="chr-a" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#FF6B6B" />
          <stop offset="55%" stopColor="#E11D48" />
          <stop offset="100%" stopColor="#9F1239" />
        </radialGradient>
        <radialGradient id="chr-b" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#FB7185" />
          <stop offset="55%" stopColor="#DB2777" />
          <stop offset="100%" stopColor="#831843" />
        </radialGradient>
        <linearGradient id="chr-stem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A3E635" />
          <stop offset="100%" stopColor="#4D7C0F" />
        </linearGradient>
      </defs>
      {shadow}
      <path d="M40 9 C30 16 24 30 21 44" fill="none" stroke="url(#chr-stem)" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M40 9 C44 20 45 32 44 42" fill="none" stroke="url(#chr-stem)" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M40 9 C49 4 58 7 60 14 C53 16 45 15 40 9 Z" fill="url(#chr-stem)" />
      <circle cx="21" cy="46" r="11" fill="url(#chr-a)" />
      <circle cx="44" cy="44" r="12" fill="url(#chr-b)" />
      <ellipse cx="17" cy="42" rx="3.4" ry="2.2" fill="#fff" opacity="0.7" transform="rotate(-30 17 42)" />
      <ellipse cx="40" cy="40" rx="3.6" ry="2.4" fill="#fff" opacity="0.7" transform="rotate(-30 40 40)" />
    </svg>
  );
}

/* ── Popular → flame ───────────────────────────────────────────────────────── */
export function ArtFlame({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="flm-a" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="55%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#FCD34D" />
        </linearGradient>
        <linearGradient id="flm-b" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#FEF08A" />
        </linearGradient>
      </defs>
      {shadow}
      <path d="M33 4 C40 16 52 22 52 36 C52 48 43 56 32 56 C21 56 12 48 12 37 C12 29 17 25 21 28 C20 19 27 12 33 4 Z" fill="url(#flm-a)" />
      <path d="M33 22 C38 29 43 33 43 41 C43 49 38 53 32 53 C26 53 22 48 22 42 C22 37 25 35 27 37 C26 31 30 26 33 22 Z" fill="url(#flm-b)" />
      <path d="M32 36 C35 40 37 42 37 46 C37 50 35 52 32 52 C29 52 27 49 27 46 C27 42 30 39 32 36 Z" fill="#FFFBEB" opacity="0.9" />
    </svg>
  );
}

/* ── Live Casino → fanned playing cards ────────────────────────────────────── */
export function ArtCards({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="crd-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#E5E7EB" />
        </linearGradient>
      </defs>
      {shadow}
      <g transform="rotate(-16 26 36)">
        <rect x="12" y="16" width="26" height="36" rx="4" fill="url(#crd-a)" stroke="rgba(0,0,0,0.08)" />
        <path d="M25 24 C30 28 31 32 25 38 C19 32 20 28 25 24 Z" fill="#111827" />
        <path d="M25 38 L22 44 L28 44 Z" fill="#111827" />
      </g>
      <g transform="rotate(14 40 34)">
        <rect x="30" y="14" width="26" height="36" rx="4" fill="url(#crd-a)" stroke="rgba(0,0,0,0.08)" />
        <path d="M43 38 C37 33 37 27 43 24 C49 27 49 33 43 38 Z" fill="#E11D48" />
        <path d="M43 22 L40 26 L46 26 Z" fill="#E11D48" />
      </g>
    </svg>
  );
}

/* ── Crash & Instant → rocket ──────────────────────────────────────────────── */
export function ArtRocket({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="rkt-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>
        <linearGradient id="rkt-flm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="60%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      {shadow}
      <path d="M34 48 C24 46 20 36 24 24 C27 14 34 8 40 6 C46 12 49 22 47 32 C45 42 40 47 34 48 Z" fill="url(#rkt-body)" stroke="rgba(0,0,0,0.08)" />
      <circle cx="37" cy="22" r="5" fill="#38BDF8" stroke="#0EA5E9" strokeWidth="1.5" />
      <path d="M24 30 C18 31 14 36 14 43 C20 41 23 38 25 34 Z" fill="#EF4444" />
      <path d="M44 36 C50 38 53 43 52 49 C46 46 44 42 43 38 Z" fill="#EF4444" />
      <path d="M30 47 C30 52 32 56 34 58 C36 56 38 52 38 47 C36 49 32 49 30 47 Z" fill="url(#rkt-flm)" />
      <circle cx="50" cy="14" r="1.8" fill="#fff" opacity="0.8" />
      <circle cx="18" cy="20" r="1.4" fill="#fff" opacity="0.7" />
    </svg>
  );
}

/* ── New Games → wrapped gift ──────────────────────────────────────────────── */
export function ArtGift({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="gft-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="gft-lid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#DDD6FE" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="gft-rib" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      {shadow}
      <rect x="16" y="28" width="32" height="26" rx="3" fill="url(#gft-box)" />
      <rect x="12" y="20" width="40" height="11" rx="3" fill="url(#gft-lid)" />
      <rect x="28" y="20" width="8" height="34" fill="url(#gft-rib)" />
      <path d="M32 20 C26 10 14 12 16 18 C18 22 27 21 32 20 Z" fill="url(#gft-rib)" />
      <path d="M32 20 C38 10 50 12 48 18 C46 22 37 21 32 20 Z" fill="url(#gft-rib)" />
      <circle cx="32" cy="19" r="3.4" fill="#FBBF24" />
    </svg>
  );
}

/* ── Jackpots → crown ──────────────────────────────────────────────────────── */
export function ArtCrown({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="crn-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="50%" stopColor="#F5B400" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="crn-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#92400E" />
        </linearGradient>
      </defs>
      {shadow}
      <path d="M10 24 L20 40 L32 22 L44 40 L54 24 L50 50 L14 50 Z" fill="url(#crn-a)" stroke="rgba(120,53,15,0.4)" />
      <rect x="13" y="49" width="38" height="7" rx="2.5" fill="url(#crn-band)" />
      <circle cx="10" cy="24" r="3.6" fill="#FCD34D" />
      <circle cx="54" cy="24" r="3.6" fill="#FCD34D" />
      <circle cx="32" cy="20" r="3.8" fill="#FCD34D" />
      <circle cx="24" cy="46" r="3" fill="#E11D48" />
      <circle cx="32" cy="44" r="3.4" fill="#7C3AED" />
      <circle cx="40" cy="46" r="3" fill="#10B981" />
    </svg>
  );
}
