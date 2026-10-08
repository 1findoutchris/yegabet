import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicPromo, SlotRow } from "@/lib/homePromos";

/*
 * Homepage promotions between game sections (managed in Admin → Homepage
 * Promos). Renders nothing when the slot has nothing live, so a hidden or
 * expired promotion never leaves a gap.
 *
 *   banner  one compact landscape panel (≈4:1 on desktop)
 *   poster  two side by side on desktop, stacked on phones; a lone poster
 *           takes the full width
 *
 * An uploaded image is shown whole (object-contain, never cropped) with no
 * text laid over it — posters usually carry their own text. Without an image
 * the promotion is an HTML panel: heading, short line, one button.
 */
export function PromoSlot({ rows }: { rows?: SlotRow[] }) {
  if (!rows?.length) return null;
  return (
    <div className="flex flex-col gap-2.5 sm:gap-3" aria-label="Promotions">
      {rows.map((row) =>
        row.kind === "banner" ? (
          <PromoPanel key={row.promo.id} promo={row.promo} shape="banner" />
        ) : (
          <div key={row.promos.map((p) => p.id).join("|")} className={cn("grid gap-2.5 sm:gap-3", row.promos.length > 1 && "sm:grid-cols-2")}>
            {row.promos.map((p) => <PromoPanel key={p.id} promo={p} shape={row.promos.length > 1 ? "poster" : "banner"} />)}
          </div>
        ),
      )}
    </div>
  );
}

function PromoLink({ promo, className, children, label }: { promo: PublicPromo; className?: string; children: React.ReactNode; label?: string }) {
  return promo.external ? (
    <a href={promo.href} target="_blank" rel="noopener noreferrer" className={className} aria-label={label}>{children}</a>
  ) : (
    <Link href={promo.href} className={className} aria-label={label}>{children}</Link>
  );
}

export function PromoPanel({ promo, shape }: { promo: PublicPromo; shape: "banner" | "poster" }) {
  const frame = "relative block w-full overflow-hidden rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)]";
  const pressable = "v-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--v-teal)]";

  if (promo.imageUrl) {
    // Desktop ≈4:1 banner / 2:1 poster; phones get a taller box so the art
    // (or the dedicated mobile image) stays legible. Box reserved up front:
    // no layout shift while it loads.
    const box = shape === "banner" ? "aspect-[2/1] sm:aspect-[4/1]" : "aspect-[2/1]";
    return (
      <PromoLink promo={promo} className={cn(frame, pressable)} label={promo.ctaLabel ?? promo.imageAlt}>
        <div className={box}>
          <picture>
            {promo.mobileImageUrl && <source media="(max-width: 639px)" srcSet={promo.mobileImageUrl} />}
            <img
              src={promo.imageUrl}
              alt={promo.imageAlt}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-contain"
            />
          </picture>
        </div>
      </PromoLink>
    );
  }

  // Text panel: HTML text, so it stays readable and accessible.
  return (
    <div className={frame}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,var(--v-teal-a12),transparent_60%)]" />
      <div className={cn(
        "relative flex gap-3 p-4 sm:p-5",
        shape === "banner" ? "flex-col sm:flex-row sm:items-center sm:justify-between min-h-[96px]" : "flex-col justify-between min-h-[132px]",
      )}>
        <div className="min-w-0">
          {promo.heading && <p className="text-[16px] sm:text-[18px] font-extrabold tracking-[-0.01em] text-white leading-snug">{promo.heading}</p>}
          {promo.description && <p className="mt-1 text-[13px] text-[color:var(--v-text-2)] leading-snug">{promo.description}</p>}
        </div>
        <PromoLink promo={promo} className="v-btn v-btn-primary h-10 px-4 text-[13px] self-start sm:self-auto shrink-0">
          {promo.ctaLabel ?? "Learn more"} <ArrowRight className="w-4 h-4" />
        </PromoLink>
      </div>
    </div>
  );
}
