/**
 * YegaBet design tokens for code that needs a value in JS (inline SVG fills,
 * canvas, computed styles). The source of truth is tokens.css; keep the two in
 * step.
 */
export const color = {
  bg0: "#000000",
  bg1: "#0A0A0A",
  bg2: "#141414",
  bg3: "#1C1C1C",
  bg4: "#262626",
  line: "rgba(200, 200, 200, 0.10)",
  line2: "rgba(200, 200, 200, 0.18)",
  teal: "#FF7A00",
  teal2: "#FFA040",
  tealDeep: "#CC5F00",
  tealInk: "#1A0B00",
  cyan: "#FFB04D",
  amber: "#F5B83D",
  green: "#34D399",
  red: "#F43F5E",
  text: "#FFFFFF",
  text2: "#C4C4C4",
  text3: "#8C8C8C",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;

export const motion = {
  fast: 150,
  base: 220,
  slow: 300,
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

/** Fixed chrome sizes. SportsPane and the players are positioned against these. */
export const chrome = { headerH: 56, navH: 64 } as const;
