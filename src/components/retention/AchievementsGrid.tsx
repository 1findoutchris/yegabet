"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ACHIEVEMENTS, type Achievement } from "@/lib/retention";

/** Permanent achievement badges, unlocked from real lifetime activity.
 *  `achievements` defaults to the built-in catalog; the server page passes the
 *  admin-configured catalog. */
export function AchievementsGrid({ achievements = ACHIEVEMENTS }: { achievements?: Achievement[] }) {
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

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Achievements</h3>
        <span className="text-[12px] text-[color:var(--text-muted)]">{earnedCount} / {achievements.length} unlocked</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {achievements.map((a) => {
          const isEarned = earned.has(a.id);
          return (
            <div
              key={a.id}
              className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl p-4 flex flex-col items-center text-center"
              style={isEarned ? undefined : { opacity: 0.55 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.badge}
                alt={a.name}
                width={56}
                height={56}
                style={{ width: 56, height: 56, filter: isEarned ? undefined : "grayscale(1)" }}
              />
              <p className="mt-2 text-[12px] font-semibold text-[color:var(--text-primary)]">{a.name}</p>
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)] leading-snug">{a.desc}</p>
              <span
                className="mt-2 text-[10px] font-bold uppercase tracking-[0.06em] rounded px-2 py-0.5"
                style={isEarned
                  ? { color: "#09090B", background: "var(--gold)" }
                  : { color: "var(--text-muted)", background: "var(--bg-elevated)" }}
              >
                {isEarned ? "Earned" : "Locked"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
