"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useBalance } from "@/contexts/BalanceContext";
import { VLogo } from "./VMark";
import { WalletWidget } from "./WalletWidget";
import { ProfileMenu } from "./ProfileMenu";
import { SearchOverlay, openSearch } from "./SearchOverlay";
import { LoadingScreen } from "./LoadingScreen";
import { sectionFor, type Section } from "./nav";

const TABS: { id: Section; href: string; label: string }[] = [
  { id: "sports",  href: "/sports",      label: "Sports" },
  { id: "live",    href: "/casino/live", label: "Live" },
  { id: "casino",  href: "/casino",      label: "Casino" },
  { id: "games",   href: "/games",       label: "Games" },
  { id: "rewards", href: "/rewards",     label: "Rewards" },
];

/**
 * VinnaBet header. Exactly 56px tall: SportsPane and the game players sit at
 * top-14 under it. Mark + wordmark left, a segmented section switcher in the
 * middle from md up, and search, the balance capsule and the avatar on the
 * right. Logged out, the right side is Log in / Join.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { openLogin, openRegister } = useAuthModal();
  const { current } = useGamePlayer();
  const { refresh } = useBalance();
  const active = sectionFor(pathname);
  const idx = TABS.findIndex((t) => t.id === active);

  // After the overlay player closes, re-check points/streak (balance already
  // updates live over the wallet stream) and nudge the engagement watcher.
  const wasPlaying = useRef(false);
  useEffect(() => {
    const playing = !!current;
    if (wasPlaying.current && !playing) {
      refresh();
      window.dispatchEvent(new Event("vinna:activity"));
    }
    wasPlaying.current = playing;
  }, [current, refresh]);

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 h-14 v-glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center gap-2 sm:gap-4">
          <Link href="/casino" aria-label="VinnaBet home" className="shrink-0">
            {/* Logged in, phones keep just the mark so the balance never truncates. */}
            <VLogo className={session ? "max-[439px]:[&>span:last-child]:hidden" : "max-[359px]:[&>span:last-child]:hidden"} />
          </Link>

          {/* Section switcher — desktop */}
          <nav className="hidden md:flex relative mx-auto p-1 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)]" aria-label="Sections">
            {idx >= 0 && (
              <span
                aria-hidden
                className="absolute top-1 bottom-1 left-1 w-[88px] rounded-full bg-[var(--v-bg-4)] shadow-[inset_0_0_0_1px_var(--v-teal-a24)] transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                style={{ transform: `translateX(${idx * 88}px)` }}
              />
            )}
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                className={cn(
                  "relative z-10 w-[88px] h-8 grid place-items-center rounded-full text-[13px] font-semibold transition-colors",
                  active === t.id ? "text-white" : "text-[color:var(--v-text-3)] hover:text-[color:var(--v-text-2)]"
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <div className="flex-1 md:flex-none" />

          <button
            onClick={openSearch}
            aria-label="Search games"
            className="shrink-0 w-9 h-9 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>

          {session ? (
            <div className="flex items-center gap-2 min-w-0">
              <WalletWidget />
              <ProfileMenu />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={openLogin} className="h-9 px-3.5 rounded-full text-[13px] font-semibold text-white hover:bg-[var(--v-bg-3)] transition-colors">
                Log in
              </button>
              <button onClick={openRegister} className="h-9 px-4 rounded-full text-[13px] font-bold bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] hover:bg-[#3FDECF] active:scale-[0.97] transition-all">
                Join
              </button>
            </div>
          )}
        </div>
      </header>

      <SearchOverlay />
      <LoadingScreen />
    </>
  );
}
