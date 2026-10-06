"use client";

import { usePathname } from "next/navigation";

/**
 * Floating "Join our channel" button, mounted for every player page except the
 * sportsbook.
 *
 * Sits above the mobile tab bar rather than beside it — the bar is a fixed
 * h-16 plus the safe-area inset, so anything at bottom-0 would be buried under
 * it on a phone. z-40 keeps it under the bar (z-50) and well under the modals
 * (z-200+), so the game player and auth sheet cover it instead of fighting it.
 *
 * Icon only on phones: the tab bar's centre FAB is already labelled "Join", and
 * a "Join our channel" pill stacked directly above it read as two competing
 * Joins — and the pill covered a game card either way. The label returns from
 * md up, where there is room and no tab bar. aria-label carries the meaning at
 * both sizes.
 *
 * Hidden on /sports: the sportsbook is a full-bleed third-party iframe with its
 * own controls in that corner, and a button floating over someone else's UI is
 * a misclick waiting to happen. Same pathname test SportsPane uses to decide it
 * is showing, so the two can't disagree about where the sportsbook is.
 */
export function TelegramChannel() {
  const pathname = usePathname();
  if (pathname.startsWith("/sports") || pathname.startsWith("/game/")) return null;

  return (
    <a
      href="https://t.me/vinnabet"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join our Telegram channel"
      data-tg-hide
      className="press fixed right-4 md:right-6 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-40
                 flex items-center justify-center gap-2 rounded-full
                 h-12 w-12 md:h-auto md:w-auto md:pl-3 md:pr-4 md:py-2.5
                 bg-[#229ED9] text-white shadow-lg shadow-[#229ED9]/25
                 hover:bg-[#1E8BC0] transition-colors"
    >
      <TelegramGlyph className="w-5 h-5 shrink-0" />
      <span className="hidden md:inline text-[13px] font-semibold whitespace-nowrap">Join our channel</span>
    </a>
  );
}

/** Telegram's paper plane. Inlined — lucide has no Telegram mark. */
function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.94.46l.34-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.0 13.01l-4.63-1.45c-1.01-.31-1.03-1 .21-1.48l18.1-6.98c.84-.31 1.57.19 1.3 1.2z" />
    </svg>
  );
}
