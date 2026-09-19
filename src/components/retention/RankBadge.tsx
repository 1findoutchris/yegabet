import type { Tier } from "@/lib/retention";

interface Props {
  tier: Tier;
  /** Rendered width in px (height follows the 96×112 art ratio). */
  size?: number;
  showName?: boolean;
  className?: string;
  /** Sweep a gold shine across the badge (use for the current/earned badge). */
  shine?: boolean;
}

/** Renders a tier's badge artwork, optionally with its name in the tier color. */
export function RankBadge({ tier, size = 40, showName = false, className, shine = false }: Props) {
  const height = Math.round((size * 112) / 96);
  // eslint-disable-next-line @next/next/no-img-element
  const art = <img src={tier.badge} alt={`${tier.name} rank`} width={size} height={height} style={{ width: size, height }} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {shine ? <span className="shine inline-flex rounded-xl">{art}</span> : art}
      {showName && (
        <span className="font-bold tracking-[-0.01em]" style={{ color: tier.color }}>
          {tier.name}
        </span>
      )}
    </span>
  );
}
