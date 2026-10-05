import { cn } from "@/lib/utils";

/**
 * The VinnaBet mark: a faceted "V" drawn from two strokes meeting at a point,
 * with a small cut diamond above the join. `animated` draws the strokes in and
 * lets the diamond breathe (used by the loaders); static everywhere else.
 */
export function VMark({
  size = 28,
  animated = false,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const draw = animated
    ? { strokeDasharray: 64, ["--len" as string]: 64, animation: "v-draw 900ms cubic-bezier(0.2,0.8,0.2,1) both" }
    : undefined;
  const drawLate = animated ? { ...draw, animationDelay: "160ms" } : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <rect x="0.5" y="0.5" width="39" height="39" rx="12" fill="#0F1A2E" stroke="rgba(148,170,210,0.18)" />
      <path d="M9 11 L20 31" stroke="#19D3C5" strokeWidth="4.2" strokeLinecap="round" style={draw} />
      <path d="M31 11 L20 31" stroke="#5CE1F0" strokeWidth="4.2" strokeLinecap="round" style={drawLate} />
      <path
        d="M20 9.5 L23 13 L20 16.5 L17 13 Z"
        fill="#FFFFFF"
        style={animated ? { transformOrigin: "20px 13px", animation: "v-breathe 1.6s ease-in-out infinite" } : undefined}
      />
    </svg>
  );
}

/** Mark + wordmark. The wordmark is set wide in caps, no gradient. */
export function VLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <VMark size={30} />
      {!compact && (
        <span className="text-[14px] font-extrabold tracking-[0.2em] text-white leading-none">
          VINNA<span className="text-[color:var(--v-teal)]">BET</span>
        </span>
      )}
    </span>
  );
}
