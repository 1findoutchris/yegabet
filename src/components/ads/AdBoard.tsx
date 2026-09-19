"use client";

import { useEffect, useRef, useState } from "react";
import type { Ad } from "@/lib/ads";
import { nearestIndex } from "@/lib/adsCore";
import { cn } from "@/lib/utils";

const INTERVAL = 5000;

// Slide positions measured off the children rather than computed from
// clientWidth — the track has padding and a gap, so its width is not the slide
// pitch. Offsets are taken relative to the first child, which cancels out the
// container's own offset and padding.
function slideOffsets(el: HTMLElement): number[] {
  const kids = Array.from(el.children) as HTMLElement[];
  const base = kids[0]?.offsetLeft ?? 0;
  return kids.map((k) => k.offsetLeft - base);
}

function currentIndex(el: HTMLElement): number {
  return nearestIndex(slideOffsets(el), el.scrollLeft);
}

/**
 * Image-only ad carousel. The track is a native scroll-snap strip, so swipe,
 * momentum and keyboard scrolling come from the browser — this component only
 * adds auto-advance and dots on top. Images keep their natural aspect ratio
 * (`h-auto`), so one upload works at every width.
 */
export function AdBoard({ ads }: { ads: Ad[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // Auto-advance. Skipped entirely for a single ad, and for users who asked for
  // reduced motion — an auto-moving carousel is exactly what that setting means.
  useEffect(() => {
    if (ads.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      // Pause while the tab is hidden, otherwise ads burn through unseen.
      if (document.hidden) return;
      const next = (currentIndex(el) + 1) % ads.length;
      el.scrollTo({ left: slideOffsets(el)[next] ?? 0, behavior: "smooth" });
    }, INTERVAL);

    return () => clearInterval(id);
  }, [ads.length]);

  if (ads.length === 0) return null;

  function goTo(i: number) {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: slideOffsets(el)[i] ?? 0, behavior: "smooth" });
  }

  return (
    <section aria-label="Advertisements" className="flex flex-col gap-2">
      <div
        ref={trackRef}
        onScroll={(e) => setIndex(currentIndex(e.currentTarget))}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-3 -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {ads.map((ad) => {
          const img = (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ad.imageUrl}
              alt=""
              loading="lazy"
              className="w-full h-auto rounded-[14px] border border-[color:var(--border-base)]"
            />
          );
          return (
            <div key={ad.id} className="w-full shrink-0 snap-start">
              {ad.linkUrl
                ? <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer sponsored">{img}</a>
                : img}
            </div>
          );
        })}
      </div>

      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {ads.map((ad, i) => (
            <button
              key={ad.id}
              onClick={() => goTo(i)}
              aria-label={`Go to ad ${i + 1}`}
              aria-current={i === index}
              className={cn(
                // Small dot, but a full-height hit area so it's tappable.
                "h-6 w-4 grid place-items-center",
                "before:block before:h-1.5 before:rounded-full before:transition-all",
                i === index
                  ? "before:w-4 before:bg-[var(--gold)]"
                  : "before:w-1.5 before:bg-[color:var(--border-base)]"
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
