"use client";

import { useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useCelebration } from "@/contexts/CelebrationContext";
import { ACHIEVEMENTS } from "@/lib/retention";

/**
 * Polls the player's streak + earned achievements and fires a celebration
 * overlay when either increases. The first observation per user is stored as a
 * silent baseline (so existing progress doesn't animate on load); only genuine
 * increases afterwards trigger an animation. State lives in localStorage,
 * keyed per user — no extra DB tables.
 */
export function EngagementWatcher() {
  const { data: session } = useSession();
  const { showStreak, showAchievement } = useCelebration();
  const userId = session?.user?.id;

  const check = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch("/api/user/achievements");
      if (!res.ok) return;
      const data = (await res.json()) as { earned?: string[]; streakDays?: number };
      const earned = data.earned ?? [];
      const streakDays = data.streakDays ?? 0;

      const streakKey = `vinna:streak:${userId}`;
      const achKey = `vinna:ach:${userId}`;

      // Streak increase
      const prevStreakRaw = localStorage.getItem(streakKey);
      if (prevStreakRaw !== null) {
        const prev = parseInt(prevStreakRaw, 10) || 0;
        if (streakDays > prev) showStreak(streakDays);
      }
      localStorage.setItem(streakKey, String(streakDays));

      // Newly earned achievements
      const prevAchRaw = localStorage.getItem(achKey);
      if (prevAchRaw !== null) {
        let seen: Set<string>;
        try { seen = new Set(JSON.parse(prevAchRaw) as string[]); } catch { seen = new Set(); }
        for (const id of earned) {
          if (!seen.has(id)) {
            const a = ACHIEVEMENTS.find((x) => x.id === id);
            if (a) showAchievement({ name: a.name, desc: a.desc, badge: a.badge });
          }
        }
      }
      localStorage.setItem(achKey, JSON.stringify(earned));
    } catch {
      /* best-effort */
    }
  }, [userId, showStreak, showAchievement]);

  useEffect(() => {
    if (!userId) return;
    check();
    const id = setInterval(check, 45_000);
    const onActivity = () => check();
    window.addEventListener("vinna:activity", onActivity);
    return () => {
      clearInterval(id);
      window.removeEventListener("vinna:activity", onActivity);
    };
  }, [userId, check]);

  return null;
}
