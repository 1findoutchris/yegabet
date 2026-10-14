"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trophy, Radio, Spade, Rocket, CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { sectionFor, type Section } from "./nav";

const TABS: { id: Section; href: string; label: string; icon: typeof Trophy }[] = [
  { id: "sports",  href: "/sports",      label: "Sports",  icon: Trophy },
  { id: "live",    href: "/casino/live", label: "Live",    icon: Radio },
  { id: "casino",  href: "/casino",      label: "Casino",  icon: Spade },
  { id: "games",   href: "/games",       label: "Games",   icon: Rocket },
  { id: "account", href: "/account",     label: "Account", icon: CircleUserRound },
];

/**
 * Phone navigation: five equal tabs and no centre button — deposit lives in
 * the header's balance capsule, the wallet sheet and Account. A turquoise bar
 * slides to the active tab. The bar is exactly 4rem + the safe-area inset,
 * which SportsPane's fixed bottom edge is built against.
 */
export function BottomNav() {
  const pathname = usePathname();
  // The game player takes the whole screen under the header on phones.
  if (pathname.startsWith("/game/")) return null;

  const active = sectionFor(pathname);
  const idx = TABS.findIndex((t) => t.id === active);

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 v-glass border-x-0 border-b-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="relative grid grid-cols-5 h-16">
        {idx >= 0 && (
          <span
            aria-hidden
            className="absolute top-0 h-[3px] w-[20%] flex justify-center transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: `translateX(${idx * 100}%)` }}
          >
            <span className="h-full w-7 rounded-b-full bg-[var(--v-teal)] shadow-[0_0_14px_rgba(255, 122, 0,0.7)]" />
          </span>
        )}
        {TABS.map((t) => {
          const on = t.id === active;
          const Icon = t.icon;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-1 v-press"
            >
              <span
                className={cn(
                  "grid place-items-center w-11 h-7 rounded-full transition-all duration-[220ms]",
                  on ? "bg-[var(--v-teal-a12)] -translate-y-0.5" : "bg-transparent"
                )}
              >
                <Icon
                  className={cn("w-[19px] h-[19px] transition-colors duration-[220ms]", on ? "text-[color:var(--v-teal)]" : "text-[color:var(--v-text-3)]")}
                  strokeWidth={on ? 2.3 : 1.9}
                />
              </span>
              <span className={cn("text-[10.5px] font-semibold tracking-[0.01em] transition-colors", on ? "text-white" : "text-[color:var(--v-text-3)]")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
