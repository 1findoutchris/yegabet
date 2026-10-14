import { cn } from "@/lib/utils";

/**
 * The YegaBet mark: a faceted "Y" drawn from two arms meeting on a stem,
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
      <rect x="0.5" y="0.5" width="39" height="39" rx="12" fill="#141414" stroke="rgba(200, 200, 200,0.18)" />
      <path d="M9 9 L20 21 L20 32" stroke="#FF7A00" strokeLinejoin="round" strokeWidth="4.2" strokeLinecap="round" style={draw} />
      <path d="M31 9 L20 21" stroke="#FFB04D" strokeWidth="4.2" strokeLinecap="round" style={drawLate} />
      <path
        d="M20 6.5 L22.5 9.5 L20 12.5 L17.5 9.5 Z"
        fill="#FFFFFF"
        style={animated ? { transformOrigin: "20px 9.5px", animation: "v-breathe 1.6s ease-in-out infinite" } : undefined}
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
          YEGA<span className="text-[color:var(--v-teal)]">BET</span>
        </span>
      )}
    </span>
  );
}
