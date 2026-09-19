"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Gift } from "lucide-react";
import { cn } from "@/lib/utils";

/* Section nav for the reward config. It was one 600-line page; each block
   already saved independently, so splitting it costs nothing and makes each
   screen scannable. Mirrors the player-facing RewardsNav. */

const TABS = [
  { slug: "",             label: "Points" },
  { slug: "deposit-bonus", label: "Deposit bonuses" },
  { slug: "tiers",        label: "Tiers" },
  { slug: "streak",       label: "Streak" },
  { slug: "challenges",   label: "Challenges" },
  { slug: "achievements", label: "Achievements" },
];

export default function RewardsAdminLayout({ children }: { children: React.ReactNode }) {
  const { secret } = useParams<{ secret: string }>();
  const pathname = usePathname();
  const base = `/admin/${secret}/rewards`;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
          <Gift className="w-5 h-5 text-[color:var(--gold)]" />
          Rewards
        </h1>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
          Each section saves on its own; code defaults apply until edited.
        </p>
      </div>

      <nav className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => {
          const href = t.slug ? `${base}/${t.slug}` : base;
          // The index tab would otherwise match every child route.
          const active = t.slug ? pathname.startsWith(href) : pathname === base;
          return (
            <Link
              key={t.slug}
              href={href}
              className={cn(
                "shrink-0 px-3.5 h-9 inline-flex items-center rounded-xl text-[13px] font-semibold border transition-colors",
                active
                  ? "bg-[var(--bg-accent-dim)] border-[color:var(--border-accent)] text-[color:var(--gold)]"
                  : "bg-[var(--bg-surface)] border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
