/*
 * Where an Octhera game goes on the site: a section (the top nav — Casino,
 * Sports, Games) and a category inside it (the section's tabs).
 *
 * Octhera's catalog gives each game a free-text `type` ("Slots", "Crash",
 * "Casino Live", …). Their docs don't list the values, so this matches on
 * words rather than exact strings, then falls back to the game's name, and
 * files anything it still can't place under Games → Other (the import logs
 * those types, see lib/catalog.ts, so a new one can be mapped here).
 *
 * Pure — no I/O — so it is unit-tested directly.
 */

export type Section = "casino" | "sports" | "games";

export type Category =
  // Casino
  | "slots"
  | "live"
  | "table"
  // Games
  | "crash"
  | "fishing"
  | "lottery"
  | "arcade"
  | "other"
  // Sports
  | "sportsbook"
  | "virtual"
  | "esports";

export interface Placement {
  section: Section;
  category: Category;
  /** false when neither the type nor the name said where it goes. */
  known: boolean;
}

/** Display order and labels of each section's categories. */
export const SECTION_CATEGORIES: Record<Section, { id: Category; label: string }[]> = {
  casino: [
    { id: "slots", label: "Slots" },
    { id: "live", label: "Live Casino" },
    { id: "table", label: "Table Games" },
  ],
  games: [
    { id: "crash", label: "Crash & Instant" },
    { id: "fishing", label: "Fishing" },
    { id: "lottery", label: "Lottery & Keno" },
    { id: "arcade", label: "Arcade" },
    { id: "other", label: "More Games" },
  ],
  sports: [
    { id: "sportsbook", label: "Sportsbook" },
    { id: "virtual", label: "Virtual Sports" },
    { id: "esports", label: "Esports" },
  ],
};

export const CATEGORY_LABEL: Record<Category, string> = Object.fromEntries(
  Object.values(SECTION_CATEGORIES)
    .flat()
    .map((c) => [c.id, c.label]),
) as Record<Category, string>;

const at = (section: Section, category: Category, known = true): Placement => ({ section, category, known });

/** Ordered: the first rule that matches wins. Tested against `type`, then against the name. */
const TYPE_RULES: [RegExp, Placement][] = [
  // Sports first — "virtual football" is sport, not a slot; "live betting" is sport, not live casino.
  [/\bvirtual/, at("sports", "virtual")],
  [/\be-?sports?\b|\besport/, at("sports", "esports")],
  [/sports?\s*book|sports?\s*betting|\bsports?\b|\bbetting\b|\bodds\b/, at("sports", "sportsbook")],
  // Casino
  [/\blive\b|live\s*casino|live\s*dealer/, at("casino", "live")],
  [/\bslots?\b|\bvideo\s*slot|\breels?\b|megaways/, at("casino", "slots")],
  [/lotter|\bkeno\b|\bbingo\b|\blotto\b|scratch|\bdraw\b/, at("games", "lottery")],
  [
    /\btable\b|roulette|blackjack|black\s*jack|baccarat|\bpoker\b|\bcards?\b|sic\s*bo|dragon\s*tiger|teen\s*patti|andar\s*bahar|\bcraps\b/,
    at("casino", "table"),
  ],
  // Games
  [
    /\bcrash\b|\binstant\b|\bmini\s*games?\b|\bturbo\b|\bmines?\b|\bplinko\b|\bdice\b|\blimbo\b|\bhi-?lo\b|\btower\b/,
    at("games", "crash"),
  ],
  [/\bfish|\bshoot/, at("games", "fishing")],
  [/\barcade\b|\bcasual\b|\bskill\b/, at("games", "arcade")],
];

/** Names that give away a game Octhera typed vaguely (e.g. type "Casino"). */
const NAME_RULES: [RegExp, Placement][] = [
  [
    /\baviator\b|\bjet\s*x\b|\bspaceman\b|\bcrash\b|\bplinko\b|\bmines\b|\blimbo\b|chicken\s*road|\bballoon\b/,
    at("games", "crash"),
  ],
  [/\bfish/, at("games", "fishing")],
  [/\bkeno\b|\bbingo\b|\blotto\b|scratch/, at("games", "lottery")],
  [
    /roulette|blackjack|baccarat|\bpoker\b|sic\s*bo|dragon\s*tiger|teen\s*patti|andar\s*bahar/,
    at("casino", "table"),
  ],
];

function norm(s: string | undefined | null): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[_/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classify(type: string | undefined | null, name: string | undefined | null): Placement {
  const t = norm(type);
  const n = norm(name);

  if (t) {
    for (const [re, p] of TYPE_RULES) if (re.test(t)) return p;
  }
  // A plain "casino"/"game" type says nothing about where — use the name.
  if (/\blive\b/.test(n) && !/\bbet/.test(n)) return at("casino", "live");
  for (const [re, p] of NAME_RULES) if (re.test(n)) return p;
  // Octhera's catalog is mostly slots; a bare "Casino" type with a slot-ish
  // name is filed as a slot rather than dumped in "More Games".
  if (/^(casino|casino games?|rng|video)$/.test(t)) return at("casino", "slots");
  return at("games", "other", false);
}

/** Lowercase slug for a provider ("Pragmatic Play" → "pragmatic-play"). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
