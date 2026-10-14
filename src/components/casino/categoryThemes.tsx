/* Single source of truth for casino category copy. Both the lobby pills and
   the destination category pages (/casino/[slug]) read from here. The old
   per-category gradients and clip-art are gone with the redesign; every
   category shares the YegaBet accent. */

export interface CategoryTheme {
  title: string;
  /** Eyebrow above the title. */
  tag: string;
  /** One line under the title. */
  description: string;
  /** Solid hex — active sub-category pill. */
  accent: string;
}

const ACCENT = "#FF7A00";

/* Keyed by the route slug used in /casino/[slug]. */
export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  hot:   { title: "Popular",         tag: "Casino",          description: "The most played titles in the lobby.",        accent: ACCENT },
  slots: { title: "Slots",           tag: "Casino",          description: "Every slot, from classics to megaways.",      accent: ACCENT },
  live:  { title: "Live Casino",     tag: "Real dealers",    description: "Roulette, blackjack, baccarat and game shows.", accent: ACCENT },
  crash: { title: "Crash & Instant", tag: "Instant games",   description: "Fast rounds, cash out any time.",             accent: ACCENT },
  new:   { title: "New Games",       tag: "New releases",    description: "The latest additions to the lobby.",          accent: ACCENT },
  table: { title: "Table Games",     tag: "Casino",          description: "Classic tables, digital and fast.",           accent: ACCENT },
};

/* Neutral theme for provider pages. */
export const DEFAULT_THEME: CategoryTheme = {
  title: "", tag: "Game provider", description: "Every title from this studio.", accent: ACCENT,
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
