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
 * An uploaded image is never cropped (object-contain) and never has text laid
 * over it. Image without a heading → the image is the whole poster (it
 * carries its own text). Heading with an image → a designed panel: HTML text
 * and button on the left, the artwork on the right. Heading alone → the same
 * panel without artwork.
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
  const picture = promo.imageUrl && (
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
  );

  // Uploaded poster, no heading: the image is the whole promotion. Desktop
  // ≈4:1 banner / 2:1 poster; phones get a taller box so the art (or the
  // dedicated mobile image) stays legible. Box reserved up front: no layout
  // shift while it loads.
  if (picture && !promo.heading) {
    const box = shape === "banner" ? "aspect-[2/1] sm:aspect-[4/1]" : "aspect-[2/1]";
    return (
      <PromoLink promo={promo} className={cn(frame, pressable)} label={promo.ctaLabel ?? promo.imageAlt}>
        <div className={box}>{picture}</div>
      </PromoLink>
    );
  }

  // Designed panel: heading, short line and button on the left in HTML text;
  // the uploaded artwork (if any) on the right, shown whole. Without a button
  // label the whole panel is the link.
  const text = (
    <div className="relative z-10 min-w-0 flex flex-col justify-center gap-1">
      {promo.heading && <p className="text-[16px] sm:text-[20px] font-extrabold tracking-[-0.02em] text-white leading-[1.15]">{promo.heading}</p>}
      {promo.description && <p className="text-[12.5px] sm:text-[14px] text-[color:var(--v-text-2)] leading-snug line-clamp-3">{promo.description}</p>}
      {promo.ctaLabel ? (
        <PromoLink promo={promo} className="v-btn v-btn-primary h-9 sm:h-10 px-4 mt-2 text-[13px] self-start">
          {promo.ctaLabel} <ArrowRight className="w-4 h-4" />
        </PromoLink>
      ) : (
        <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-[color:var(--v-teal)]">Open <ArrowRight className="w-3.5 h-3.5" /></span>
      )}
    </div>
  );
  const body = (
    <>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_50%,var(--v-teal-a12),transparent_65%)]" />
      <div className={cn(
        "relative grid items-center gap-3 p-4 sm:p-6",
        picture ? "grid-cols-[minmax(0,1fr)_40%] sm:grid-cols-[minmax(0,1fr)_42%]" : "grid-cols-1",
        shape === "banner" ? "min-h-[136px] sm:min-h-[176px]" : "min-h-[136px] sm:min-h-[168px]",
      )}>
        {text}
        {picture && <div className="relative self-stretch min-h-[104px]">{picture}</div>}
      </div>
    </>
  );
  return promo.ctaLabel ? (
    <div className={frame}>{body}</div>
  ) : (
    <PromoLink promo={promo} className={cn(frame, pressable)} label={promo.heading ?? undefined}>{body}</PromoLink>
  );
}
