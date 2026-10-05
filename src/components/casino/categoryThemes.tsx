/* Single source of truth for casino category styling.
   Both the lobby tiles (CategoryGrid) and the destination category pages
   (/casino/[slug]) read from here so a tile and the page it opens share the
   exact same gradient, glow, and artwork. */

import {
  ArtFlame, ArtCherries, ArtCards, ArtRocket, ArtGift, ArtCrown,
} from "./CategoryArt";

const G = {
  orange:  "linear-gradient(150deg,#FF9D2E 0%,#FB6107 55%,#C2410C 100%)",
  gold:    "linear-gradient(150deg,#FFE07A 0%,#2DD4BF 50%,#0D9488 100%)",
  crimson: "linear-gradient(150deg,#FF6B8A 0%,#F0285A 55%,#A8123E 100%)",
  blue:    "linear-gradient(150deg,#4FD0FF 0%,#2B7FFF 55%,#3730D8 100%)",
  violet:  "linear-gradient(150deg,#C29BFF 0%,#C07AFF 50%,#6620C9 100%)",
  emerald: "linear-gradient(150deg,#3BE6A6 0%,#10B57E 55%,#067A53 100%)",
} as const;

type Art = React.ComponentType<{ className?: string }>;

export interface CategoryTheme {
  title: string;
  tag: string;
  grad: string;      // face / banner gradient
  glow: string;      // strong colour — hover + header glow
  tint: string;      // soft colour — page background bloom
  accent: string;    // solid hex — active sub-category chips
  Art: Art;
}

/* Keyed by the route slug used in /casino/[slug]. */
export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  hot:   { title: "Popular",         tag: "Trending now",  grad: G.orange,  glow: "rgba(251,97,7,0.55)",   tint: "rgba(251,97,7,0.16)",   accent: "#FB6107", Art: ArtFlame    },
  slots: { title: "Slots",           tag: "Spin to win",   grad: G.gold,    glow: "rgba(45,212,191,0.55)",  tint: "rgba(45,212,191,0.16)",  accent: "#2DD4BF", Art: ArtCherries },
  live:  { title: "Live Casino",     tag: "Real dealers",  grad: G.crimson, glow: "rgba(240,40,90,0.55)",  tint: "rgba(240,40,90,0.16)",  accent: "#F0285A", Art: ArtCards    },
  crash: { title: "Crash & Instant", tag: "Cash out fast", grad: G.blue,    glow: "rgba(43,127,255,0.55)", tint: "rgba(43,127,255,0.16)", accent: "#3B82F6", Art: ArtRocket   },
  new:   { title: "New Games",       tag: "Fresh drops",   grad: G.violet,  glow: "rgba(192,122,255,0.55)", tint: "rgba(192,122,255,0.16)", accent: "#C07AFF", Art: ArtGift     },
  table: { title: "Table Games",     tag: "Classic tables", grad: G.emerald, glow: "rgba(16,181,126,0.55)", tint: "rgba(16,181,126,0.16)", accent: "#10B57E", Art: ArtCrown    },
};

/* Neutral theme for provider pages (no dedicated category art). */
export const DEFAULT_THEME: CategoryTheme = {
  title: "", tag: "Game provider", grad: G.gold,
  glow: "rgba(45,212,191,0.5)", tint: "rgba(45,212,191,0.14)", accent: "#2DD4BF", Art: ArtCherries,
};

/* ── Sub-categories ────────────────────────────────────────────────────────
   Plain serialisable data (icon is a key into SUBCAT_ICONS, resolved on the
   client) so it can cross the server→client boundary. A game belongs to a
   sub-category when its name contains any keyword; empty ones auto-hide. */
export interface SubCat {
  id: string;
  label: string;
  icon: string;       // key in SUBCAT_ICONS
  keywords: string[]; // lowercase name fragments
}

// Reusable slot-theme set (also used for provider pages).
const SLOT_SUBS: SubCat[] = [
  { id: "megaways", label: "Megaways",   icon: "megaways", keywords: ["megaways"] },
  { id: "holdwin",  label: "Hold & Win", icon: "holdwin",  keywords: ["hold", "link", "respin", "lock"] },
  { id: "fruits",   label: "Fruits",     icon: "fruits",   keywords: ["fruit", "berry", "melon", "mango", "citrus"] },
  { id: "classic",  label: "Classic",    icon: "classic",  keywords: ["777", "seven", "classic", "joker", "bell"] },
  { id: "egypt",    label: "Egypt",      icon: "egypt",    keywords: ["egypt", "pharaoh", "cleopatra", "anubis", "horus", "pyramid", "sphinx", "nile", "book of"] },
  { id: "gold",     label: "Gold & Riches", icon: "gold",  keywords: ["gold", "golden", "riches", "treasure", "fortune", "lucky", "money", "cash"] },
  { id: "bonusbuy", label: "Bonus Buy",  icon: "bonusbuy", keywords: ["bonus", "buy"] },
];

export const SUBCATEGORIES: Record<string, SubCat[]> = {
  live: [
    { id: "roulette",    label: "Roulette",     icon: "roulette",    keywords: ["roulette"] },
    { id: "blackjack",   label: "Blackjack",    icon: "blackjack",   keywords: ["blackjack", "black jack"] },
    { id: "baccarat",    label: "Baccarat",     icon: "baccarat",    keywords: ["baccarat", "bacc"] },
    { id: "gameshow",    label: "Game Shows",   icon: "gameshow",    keywords: ["crazy time", "monopoly", "dream catcher", "mega ball", "deal or no", "funky time", "game show", "crazy coin", "lightning storm", "candyland", "xxxtreme", "balloon race"] },
    { id: "poker",       label: "Poker",        icon: "poker",       keywords: ["poker", "hold'em", "holdem", "casino hold"] },
    { id: "dragontiger", label: "Dragon Tiger", icon: "dragontiger", keywords: ["dragon tiger", "dragon-tiger", "andar bahar", "teen patti", "sic bo", "fan tan"] },
  ],
  crash: [
    { id: "crash",  label: "Crash",  icon: "crash",  keywords: ["aviator", "crash", "jetx", "jet x", "spaceman", "rocket", "cosmic", "space"] },
    { id: "mines",  label: "Mines",  icon: "mines",  keywords: ["mines", "mine"] },
    { id: "plinko", label: "Plinko", icon: "plinko", keywords: ["plinko", "pachinko"] },
    { id: "dice",   label: "Dice",   icon: "dice",   keywords: ["dice", "limbo"] },
    { id: "wheel",  label: "Wheel",  icon: "wheel",  keywords: ["wheel", "fortune"] },
    { id: "keno",   label: "Keno",   icon: "keno",   keywords: ["keno", "lotto", "balloon"] },
  ],
  slots: SLOT_SUBS,
  table: [
    { id: "roulette",    label: "Roulette",     icon: "roulette",    keywords: ["roulette"] },
    { id: "blackjack",   label: "Blackjack",    icon: "blackjack",   keywords: ["blackjack", "black jack"] },
    { id: "baccarat",    label: "Baccarat",     icon: "baccarat",    keywords: ["baccarat", "bacc"] },
    { id: "poker",       label: "Poker",        icon: "poker",       keywords: ["poker", "hold'em", "holdem"] },
    { id: "dragontiger", label: "Dragon Tiger", icon: "dragontiger", keywords: ["dragon tiger", "dragon-tiger", "andar bahar", "teen patti", "sic bo", "fan tan"] },
  ],
  hot:   SLOT_SUBS,
  new:   SLOT_SUBS,
  default: SLOT_SUBS,
};

/* Ordered tiles for the lobby grid. `countKey` selects the live count. */
export interface LobbyTile {
  slug: string;
  title: string;
  tag: string;
  grad: string;
  glow: string;
  Art: Art;
  countKey: "all" | "hot" | "slots" | "live" | "crash" | "new" | "table";
  /** Where the tile goes, when not /casino/<slug>. */
  href?: string;
}

export const LOBBY_TILES: LobbyTile[] = [
  { slug: "hot",   title: "Popular",         tag: "Trending now",  grad: G.orange,  glow: "rgba(251,97,7,0.55)",   Art: ArtFlame,    countKey: "hot"   },
  { slug: "slots", title: "Slots",           tag: "Spin to win",   grad: G.gold,    glow: "rgba(45,212,191,0.55)",  Art: ArtCherries, countKey: "slots" },
  { slug: "live",  title: "Live Casino",     tag: "Real dealers",  grad: G.crimson, glow: "rgba(240,40,90,0.55)",  Art: ArtCards,    countKey: "live"  },
  { slug: "table", title: "Table Games",     tag: "Classic tables", grad: G.emerald, glow: "rgba(16,181,126,0.55)", Art: ArtCrown,   countKey: "table" },
  { slug: "new",   title: "New Games",       tag: "Fresh drops",   grad: G.violet,  glow: "rgba(192,122,255,0.55)", Art: ArtGift,     countKey: "new"   },
  // Crash & instant games live in the Games section.
  { slug: "crash", title: "Crash & Instant", tag: "Cash out fast", grad: G.blue,    glow: "rgba(43,127,255,0.55)", Art: ArtRocket,   countKey: "crash", href: "/games?tab=crash" },
];
