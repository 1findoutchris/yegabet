// Game groups inside a catalog category (Live → Roulette, Games → Mines …).
// Pure — shared by the lobbies, the full category browser and the self-check.
//
// The provider's own `type` decides first: Octhera sends a free-text type per
// game ("Crash", "Instant", "Mines", "Casino Live" …). Only when that type is
// generic (e.g. "Casino Live" says nothing about roulette vs. blackjack) does
// the game's name decide, and then only within the category the provider type
// already put it in — a slot can never land in a live group by name.

import type { Game } from "@/types/games";

export interface GameGroup {
  id: string;
  label: string;
  /** Key into the illustrated icon set (components/vinna/CategoryArt). */
  icon: string;
  /** Matched against the provider's game type (lowercase fragments). */
  types: string[];
  /** Fallback: matched against the game name when the type is generic. */
  keywords: string[];
}

export const LIVE_GROUPS: GameGroup[] = [
  { id: "roulette", label: "Roulette", icon: "roulette", types: ["roulette"], keywords: ["roulette"] },
  { id: "blackjack", label: "Blackjack", icon: "blackjack", types: ["blackjack", "black jack"], keywords: ["blackjack", "black jack"] },
  { id: "baccarat", label: "Baccarat", icon: "baccarat", types: ["baccarat"], keywords: ["baccarat", "bacc"] },
  {
    id: "gameshow", label: "Game Shows", icon: "gameshow", types: ["game show", "gameshow", "show"],
    keywords: ["crazy time", "monopoly", "dream catcher", "mega ball", "deal or no", "funky time", "game show", "crazy coin", "lightning storm", "sweet bonanza candyland", "candyland", "balloon race", "mega wheel", "boom city", "wheel of fortune"],
  },
  { id: "poker", label: "Poker", icon: "poker", types: ["poker"], keywords: ["poker", "hold'em", "holdem", "casino hold"] },
  { id: "dragontiger", label: "Dragon Tiger", icon: "dragontiger", types: ["dragon tiger"], keywords: ["dragon tiger", "dragon-tiger"] },
  { id: "dice", label: "Sic Bo & Dice", icon: "dice", types: ["sic bo", "sicbo", "dice"], keywords: ["sic bo", "sicbo", "super sic", "dice", "craps"] },
  { id: "andarbahar", label: "Andar Bahar", icon: "cards", types: ["andar bahar", "teen patti"], keywords: ["andar bahar", "teen patti"] },
];

export const FAST_GROUPS: GameGroup[] = [
  { id: "crash", label: "Crash", icon: "crash", types: ["crash"], keywords: ["aviator", "crash", "jetx", "jet x", "spaceman", "rocket", "chicken road", "aviatrix"] },
  { id: "mines", label: "Mines", icon: "mines", types: ["mines", "mine"], keywords: ["mines"] },
  { id: "plinko", label: "Plinko", icon: "plinko", types: ["plinko", "pachinko"], keywords: ["plinko", "pachinko"] },
  { id: "dice", label: "Dice", icon: "dice", types: ["dice", "limbo"], keywords: ["dice", "limbo"] },
  { id: "wheel", label: "Wheel", icon: "wheel", types: ["wheel"], keywords: ["wheel"] },
  { id: "hilo", label: "Hi-Lo & Cards", icon: "cards", types: ["hilo", "hi-lo", "hi lo"], keywords: ["hilo", "hi-lo", "hi lo"] },
  { id: "instant", label: "Instant", icon: "instant", types: ["instant", "mini game", "mini-game", "turbo", "tower"], keywords: [] },
];

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[_/|]+/g, " ").replace(/\s+/g, " ").trim();
const has = (hay: string, needles: string[]) => needles.some((n) => n && hay.includes(n));

/** The group a game belongs to, by provider type first, then by name. */
export function groupOf(game: Pick<Game, "type" | "gameNameEn">, groups: GameGroup[]): string | null {
  const t = norm(game.type);
  if (t) for (const g of groups) if (has(t, g.types)) return g.id;
  const n = norm(game.gameNameEn);
  for (const g of groups) if (has(n, g.keywords)) return g.id;
  return null;
}

/** Games of each group, in the order given; empty groups are left out. */
export function splitByGroup<T extends Pick<Game, "type" | "gameNameEn">>(games: T[], groups: GameGroup[]) {
  const by = new Map<string, T[]>(groups.map((g) => [g.id, []]));
  for (const game of games) {
    const id = groupOf(game, groups);
    if (id) by.get(id)!.push(game);
  }
  return groups.map((g) => ({ ...g, games: by.get(g.id)! })).filter((g) => g.games.length > 0);
}
