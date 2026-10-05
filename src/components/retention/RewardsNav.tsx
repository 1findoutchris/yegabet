"use client";

import { CategoryTabs } from "@/components/vinna/CategoryTabs";
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
  const active = TABS.find((t) => (t.href === "/rewards" ? pathname === "/rewards" : pathname.startsWith(t.href)))?.href;
  return (
    <CategoryTabs
      label="Rewards sections"
      active={active}
      tabs={TABS.map((t) => ({ id: t.href, label: t.label, href: t.href }))}
    />
  );
}
