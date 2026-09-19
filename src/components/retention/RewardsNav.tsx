"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/rewards",              label: "Overview" },
  { href: "/rewards/streak",       label: "Streak" },
  { href: "/rewards/spin",         label: "Spin" },
  { href: "/rewards/bonuses",      label: "Bonuses" },
  { href: "/rewards/achievements", label: "Achievements" },
  { href: "/rewards/leaderboards", label: "Leaderboards" },
  { href: "/rewards/vip",          label: "VIP" },
];

export function RewardsNav() {
  const pathname = usePathname();
  const tabs = TABS;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {tabs.map((t) => {
        const active = t.href === "/rewards" ? pathname === "/rewards" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "whitespace-nowrap px-4 py-[7px] rounded-lg text-[12px] transition-all duration-150 " +
              (active
                ? "bg-[var(--bg-accent-dim)] border border-[color:var(--gold)] text-[color:var(--gold)] font-semibold"
                : "bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-medium hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
