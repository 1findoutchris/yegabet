// Homepage promotions — pure rules (validation, visibility, layout), shared by
// the admin API, the homepage and the self-check. No server-only imports.

/** Where on the homepage a promotion can sit. Promotions never go above the
 *  first game section — games stay visible the moment the page opens. */
export const PROMO_SLOTS = [
  { id: "after_first", label: "After the first game section" },
  { id: "middle", label: "Middle of the page (after Slots)" },
  { id: "lower", label: "Lower on the page" },
] as const;
export type PromoSlot = (typeof PROMO_SLOTS)[number]["id"];

export const PROMO_LAYOUTS = [
  { id: "banner", label: "Wide banner" },
  { id: "poster", label: "Poster (shown in pairs)" },
] as const;
export type PromoLayout = (typeof PROMO_LAYOUTS)[number]["id"];

export const DEST_TYPES = [
  { id: "internal", label: "Page on VinnaBet" },
  { id: "external", label: "External website (https)" },
] as const;
export type DestType = (typeof DEST_TYPES)[number]["id"];

/** Ready-made internal destinations offered in the admin form. */
export const QUICK_DESTINATIONS = [
  { label: "Deposit", path: "/deposit" },
  { label: "Rewards", path: "/rewards" },
  { label: "Bonuses", path: "/rewards/bonuses" },
  { label: "Prize wheel", path: "/rewards/spin" },
  { label: "Sports", path: "/sports" },
  { label: "Casino lobby", path: "/casino" },
  { label: "Slots", path: "/casino/slots" },
  { label: "Live casino", path: "/casino/live" },
  { label: "Table games", path: "/casino/table" },
  { label: "Crash games", path: "/games?tab=crash" },
  { label: "All games", path: "/games" },
  { label: "Check ticket", path: "/check" },
];

export const isSlot = (v: unknown): v is PromoSlot => PROMO_SLOTS.some((s) => s.id === v);
export const isLayout = (v: unknown): v is PromoLayout => PROMO_LAYOUTS.some((s) => s.id === v);
export const isDestType = (v: unknown): v is DestType => DEST_TYPES.some((s) => s.id === v);

/**
 * Is this a link a promotion may point at?
 *   internal — a path on this site: starts with one "/", no scheme, no "//"
 *              (protocol-relative), no backslashes or whitespace.
 *   external — an https URL with a host. Plain http is refused.
 */
export function validDestination(type: DestType, url: string): boolean {
  if (!url || url.length > 500) return false;
  if (type === "internal") {
    return /^\/(?!\/)[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(url) && !url.includes("\\");
  }
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !!u.hostname && !/\s/.test(url);
  } catch {
    return false;
  }
}

export type PromoRecord = {
  id: string;
  title: string;
  heading: string | null;
  description: string | null;
  hasImage: boolean;
  hasMobileImage: boolean;
  imageAlt: string | null;
  ctaLabel: string | null;
  destType: string;
  destUrl: string | null;
  layout: string;
  slot: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

/**
 * Why a promotion isn't shown right now (null = it is). The homepage shows
 * only complete promotions: switched on, inside its dates, with either an
 * image or a heading to show, a valid destination, and — for an image —
 * alternative text.
 */
export function hiddenReason(p: PromoRecord, now: Date): string | null {
  if (!p.isActive) return "Switched off";
  if (p.startsAt && p.startsAt > now) return "Not started yet";
  if (p.endsAt && p.endsAt <= now) return "Ended";
  if (!isSlot(p.slot) || !isLayout(p.layout)) return "Invalid placement";
  if (!p.hasImage && !p.heading?.trim()) return "Needs an image or a heading";
  if (p.hasImage && !p.imageAlt?.trim()) return "Image needs alternative text";
  if (!isDestType(p.destType) || !p.destUrl || !validDestination(p.destType, p.destUrl)) return "Needs a valid destination";
  return null;
}

/**
 * How one slot's live promotions are laid out, in display order: each banner
 * on its own row, posters two to a row. An odd poster out takes the whole row
 * rather than leaving an empty half.
 */
export function slotRows<T extends { layout: string }>(promos: T[]): ({ kind: "banner"; promo: T } | { kind: "posters"; promos: T[] })[] {
  const rows: ({ kind: "banner"; promo: T } | { kind: "posters"; promos: T[] })[] = [];
  let pending: T[] = [];
  const flush = () => {
    if (pending.length) rows.push({ kind: "posters", promos: pending });
    pending = [];
  };
  for (const p of promos) {
    if (p.layout === "poster") {
      pending.push(p);
      if (pending.length === 2) flush();
    } else {
      flush();
      rows.push({ kind: "banner", promo: p });
    }
  }
  flush();
  return rows;
}

/** Image upload rules shared by the admin route. */
export const PROMO_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
export const PROMO_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export function imageProblem(file: { type: string; size: number }): string | null {
  if (!PROMO_IMAGE_TYPES.includes(file.type)) return "Image must be JPEG, PNG, WebP, AVIF or GIF";
  if (file.size === 0) return "Image is empty";
  if (file.size > PROMO_IMAGE_MAX_BYTES) return "Image must be under 4 MB";
  return null;
}
