/**
 * VinnaBet design tokens for code that needs a value in JS (inline SVG fills,
 * canvas, computed styles). The source of truth is tokens.css; keep the two in
 * step.
 */
export const color = {
  bg0: "#060B16",
  bg1: "#0A1222",
  bg2: "#0F1A2E",
  bg3: "#15233B",
  bg4: "#1C2D4A",
  line: "rgba(148, 170, 210, 0.10)",
  line2: "rgba(148, 170, 210, 0.18)",
  teal: "#19D3C5",
  teal2: "#5EE6DA",
  tealDeep: "#0E9F94",
  tealInk: "#03211F",
  cyan: "#5CE1F0",
  amber: "#F5B83D",
  green: "#34D399",
  red: "#F43F5E",
  text: "#FFFFFF",
  text2: "#B4C2DA",
  text3: "#7D8DAA",
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
