/* Compact custom SVG glyphs for casino sub-categories.
   Monochrome (currentColor) so a sub-category chip can tint them to the active
   category accent. Recognisable over pixel-perfect — they sit ~18px tall. */

type P = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IcAll({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

function IcRoulette({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function IcSpade({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 3C12 3 4.5 8.5 4.5 13.2A3.3 3.3 0 0 0 10 15.7c.1 1.6-.7 3.3-1.9 4.3h7.8c-1.2-1-2-2.7-1.9-4.3a3.3 3.3 0 0 0 5.5-2.5C19.5 8.5 12 3 12 3Z" />
    </svg>
  );
}

function IcCards({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="3.5" y="6.5" width="9.5" height="13" rx="2" transform="rotate(-9 8 13)" />
      <rect x="11" y="5" width="9.5" height="13" rx="2" transform="rotate(9 15.5 11.5)" />
    </svg>
  );
}

function IcGameShow({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.5l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 21.2 6.9 17.9 8 12.3 3.8 8.4l5.7-.7L12 2.5Z" />
      <circle cx="20" cy="4" r="1.1" />
      <circle cx="4" cy="6" r="0.9" />
    </svg>
  );
}

function IcChips({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="13" cy="13" r="7.2" />
      <circle cx="13" cy="13" r="3" />
      <path d="M13 5.8v2M13 18.2v2M5.8 13h2M18.2 13h2" />
      <path d="M7 21.5a6 6 0 0 1-3.5-5.4" opacity="0.9" />
    </svg>
  );
}

function IcDragonTiger({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 1 0 9" />
      <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IcRocket({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M14.5 3.5c2.8 1.2 4 5 2.8 8.4l-2.6 2.8-3.4-3.4 2.6-2.8c1.6-1.6 .6-5 .6-5Z" />
      <path d="M11.3 11.3 8 14.7M9 8.5 5.5 9.5 4 13l3.2-1M16 16l1 3.5 3.5-1.5-1-3.2" />
      <path d="M9.5 16.5c-1 1-1.3 3-1 4 1-.3 3-.6 4-1.6" />
    </svg>
  );
}

function IcBomb({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="10.5" cy="15" r="6.2" />
      <path d="M15 10.5l2.3-2.3M17.3 8.2V5.6M17.3 8.2h2.6" />
      <path d="M8 13a3.4 3.4 0 0 1 2.6-2" opacity="0.9" />
    </svg>
  );
}

function IcPlinko({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="8" cy="11" r="1.4" /><circle cx="16" cy="11" r="1.4" />
      <circle cx="5" cy="17" r="1.4" /><circle cx="12" cy="17" r="1.4" /><circle cx="19" cy="17" r="1.4" />
      <circle cx="12" cy="11" r="1.4" opacity="0.45" />
    </svg>
  );
}

function IcDice({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3.4" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IcWheel({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 5v16M4 13h16M6.3 7.3l11.4 11.4M17.7 7.3 6.3 18.7" />
      <path d="M12 2.5l1.8 2.6h-3.6L12 2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IcKeno({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M8.4 8.4l1.6 1.6" opacity="0.9" />
    </svg>
  );
}

function IcMegaways({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function IcCoin({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 9.5v5M10.5 11h3" />
    </svg>
  );
}

function IcFruit({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M14 4c-2 1.4-3.3 3.3-3.8 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 4c2-1 4 0 4.5 1.6-1.5.4-3.3.2-4.5-1.6Z" />
      <circle cx="8.5" cy="15.5" r="4" />
      <circle cx="15.5" cy="14.5" r="4.3" />
      <circle cx="7" cy="14" r="1" fill="#fff" opacity="0.6" />
    </svg>
  );
}

function IcClassic({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M9 6v12M15 6v12" />
      <path d="M6 13.5l1.5-3.5M12 13.5l1.5-3.5M18 13.5l1.5-3.5" />
    </svg>
  );
}

function IcEgypt({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M12 4 21 20H3L12 4Z" />
      <path d="M9 14.5h6M7.5 17.5h9" />
      <circle cx="12" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IcGift({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="4.5" y="10" width="15" height="10" rx="1.6" />
      <path d="M3.5 10h17M12 10v10" />
      <path d="M12 10c-2.5-3.5-6-2-5 .3M12 10c2.5-3.5 6-2 5 .3" />
    </svg>
  );
}

function IcGold({ className }: P) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M8 9h8l2 4H6l2-4Z" />
      <path d="M4 14h7l1.5 4H2.5L4 14ZM13 14h7l-1.5 4h-7L13 14Z" />
    </svg>
  );
}

export const SUBCAT_ICONS: Record<string, React.ComponentType<P>> = {
  all: IcAll,
  roulette: IcRoulette,
  blackjack: IcSpade,
  baccarat: IcCards,
  gameshow: IcGameShow,
  poker: IcChips,
  dragontiger: IcDragonTiger,
  crash: IcRocket,
  mines: IcBomb,
  plinko: IcPlinko,
  dice: IcDice,
  wheel: IcWheel,
  keno: IcKeno,
  megaways: IcMegaways,
  holdwin: IcCoin,
  fruits: IcFruit,
  classic: IcClassic,
  egypt: IcEgypt,
  bonusbuy: IcGift,
  gold: IcGold,
};
