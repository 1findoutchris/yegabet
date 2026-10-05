"use client";

import { SectionHeader } from "@/components/vinna/SectionHeader";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ACHIEVEMENTS, type Achievement } from "@/lib/retention";

/** Permanent achievement badges, unlocked from real lifetime activity.
 *  `achievements` defaults to the built-in catalog; the server page passes the
 *  admin-configured catalog. */
export function AchievementsGrid({
  achievements = ACHIEVEMENTS,
  limit,
}: {
  achievements?: Achievement[];
  /** Show only the first N (earned first) with a "View all" link. */
  limit?: number;
}) {
  const { status } = useSession();
  const [earned, setEarned] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (status !== "authenticated") return;
    fetch("/api/user/achievements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { earned?: string[] } | null) => {
        if (d?.earned) setEarned(new Set(d.earned));
      })
      .catch(() => { /* ignore */ });
  }, [status]);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-check after gameplay so a fresh unlock reflects without a reload.
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("vinna:activity", handler);
    return () => window.removeEventListener("vinna:activity", handler);
  }, [refresh]);

  const earnedCount = achievements.filter((a) => earned.has(a.id)).length;

  const list = limit
    ? [...achievements].sort((x, y) => Number(earned.has(y.id)) - Number(earned.has(x.id))).slice(0, limit)
    : achievements;

  return (
    <section>
      <SectionHeader
        title="Achievements"
        description={`${earnedCount} of ${achievements.length} unlocked`}
        href={limit ? "/rewards/achievements" : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {list.map((a) => {
          const isEarned = earned.has(a.id);
          return (
            <div key={a.id} className={"v-surface p-4 flex items-center gap-3 " + (isEarned ? "" : "opacity-60")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.badge}
                alt={a.name}
                width={40}
                height={40}
                className="shrink-0"
                style={{ width: 40, height: 40, filter: isEarned ? undefined : "grayscale(1)" }}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white truncate">{a.name}</p>
                <p className="mt-0.5 text-[11px] text-[color:var(--v-text-3)] leading-snug line-clamp-2">{a.desc}</p>
                <p className={"mt-1 text-[10px] font-bold uppercase tracking-[0.1em] " + (isEarned ? "text-[color:var(--v-teal)]" : "text-[color:var(--v-text-3)]")}>
                  {isEarned ? "Unlocked" : "Locked"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
