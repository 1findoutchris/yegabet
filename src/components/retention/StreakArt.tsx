/* Custom streak flame illustration — a glossy gradient flame whose intensity
   escalates with the streak length (ember → flame → blue → inferno), and reads
   grey when the streak is inactive. */

import { useId } from "react";
import { streakFlameTier } from "@/lib/retention";

type P = { className?: string; days?: number; active?: boolean };

// Per-tier gradient palettes: [outer 3 stops] + [inner core 2 stops].
const TIER_GRAD: Record<number, { outer: [string, string, string]; inner: [string, string] }> = {
  0: { outer: ["#9CA3AF", "#6B7280", "#4B5563"], inner: ["#D1D5DB", "#9CA3AF"] }, // grey / inactive
  1: { outer: ["#FFE3A3", "#FBB14B", "#F2741E"], inner: ["#FFF6D8", "#FFC857"] }, // ember
  2: { outer: ["#FFD66B", "#FB8B24", "#F0285A"], inner: ["#FFF6D8", "#FFB020"] }, // flame
  3: { outer: ["#FFE8A3", "#FF7A1A", "#E01E5A"], inner: ["#FFFBEA", "#FF9E2C"] }, // hot
  4: { outer: ["#BFE3FF", "#5AA9FF", "#2D6BFF"], inner: ["#EAF5FF", "#7FC0FF"] }, // blue
  5: { outer: ["#FFF1C2", "#FF8A1E", "#FF2D6E"], inner: ["#FFFFFF", "#FFD36B"] }, // inferno
};

export function StreakFlame({ className, days = 0, active = true }: P) {
  const uid = useId();
  const tier = active ? streakFlameTier(days) : 0;
  const { outer, inner } = TIER_GRAD[tier];
  const outerId = `sf-${uid}-o`;
  const innerId = `sf-${uid}-i`;
  const baseId = `sf-${uid}-b`;

  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={outerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={outer[0]} />
          <stop offset="45%" stopColor={outer[1]} />
          <stop offset="100%" stopColor={outer[2]} />
        </linearGradient>
        <linearGradient id={innerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={inner[0]} />
          <stop offset="100%" stopColor={inner[1]} />
        </linearGradient>
        <radialGradient id={baseId} cx="50%" cy="65%" r="55%">
          <stop offset="0%" stopColor="#A855F7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#A855F7" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Violet base glow — only at the top inferno tier */}
      {tier >= 5 && <circle cx="16" cy="22" r="13" fill={`url(#${baseId})`} />}

      {/* Outer flame */}
      <path
        d="M17.5 2.2c1 4.4 5 6.3 5 11.4a8.3 8.3 0 0 1-16.6.5C5.9 9.4 9.7 7.7 11.2 3c.6 2.7 2.1 4 3.2 5.2.9-2.1.6-4.3-.9-6Z"
        fill={`url(#${outerId})`}
        opacity={tier === 0 ? 0.55 : 1}
      />

      {/* Inner core */}
      <path
        d="M16 14.2c.6 2.1 2.5 3 2.5 5.3a3.6 3.6 0 0 1-7.2.2c0-1.9 1.3-3 2.1-4 .3 1.1 1 1.7 1.7 2-.4-1.4-.2-2.5.9-3.5Z"
        fill={`url(#${innerId})`}
        opacity={tier === 0 ? 0.5 : 1}
      />

      {/* Sparks — high tiers only */}
      {tier >= 4 && <circle cx="24" cy="8" r="1.1" fill={inner[0]} />}
      {tier >= 5 && <circle cx="7.5" cy="11" r="1" fill={inner[0]} />}
    </svg>
  );
}
