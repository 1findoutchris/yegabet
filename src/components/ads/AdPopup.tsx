"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Ad } from "@/lib/ads";
import { pickUnseenAd } from "@/lib/adsCore";

const KEY = "adSeen"; // localStorage: `${adId}:${YYYY-MM-DD}` of last dismissal

/**
 * Image-only popup ad — shows the newest live one, once per day per device.
 * Sized in viewport units with `object-contain`, so any image shape fits on any
 * phone without cropping or overflowing.
 */
export function AdPopup({ ads }: { ads: Ad[] }) {
  const [ad, setAd] = useState<Ad | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setAd(pickUnseenAd(ads, localStorage.getItem(KEY), today));
  }, [ads]);

  if (!ad) return null;

  function dismiss() {
    if (ad) localStorage.setItem(KEY, `${ad.id}:${new Date().toISOString().slice(0, 10)}`);
    setAd(null);
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ad.imageUrl}
      alt=""
      className="w-full h-auto max-h-[70vh] object-contain rounded-2xl"
    />
  );

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      onClick={dismiss}
    >
      <div className="relative w-[min(92vw,420px)]" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={dismiss}
          aria-label="Close ad"
          // 44px tap target — sits just outside the image corner.
          className="absolute -top-3 -right-3 w-11 h-11 grid place-items-center rounded-full bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)]"
        >
          <X className="w-5 h-5" />
        </button>
        {ad.linkUrl
          ? <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={dismiss}>{img}</a>
          : img}
      </div>
    </div>
  );
}
