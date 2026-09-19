"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { celebrate } from "@/lib/celebrate";
import { StreakFlame } from "@/components/retention/StreakArt";

interface AchievementLite { name: string; desc: string; badge: string }

type CelebrationEvent =
  | { kind: "streak"; days: number }
  | { kind: "achievement"; name: string; desc: string; badge: string };

interface CelebrationContextType {
  showStreak: (days: number) => void;
  showAchievement: (a: AchievementLite) => void;
}

const CelebrationContext = createContext<CelebrationContextType>({
  showStreak: () => {},
  showAchievement: () => {},
});

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<CelebrationEvent[]>([]);
  const current = queue[0] ?? null;

  const showStreak = useCallback((days: number) => {
    setQueue((q) => [...q, { kind: "streak", days }]);
  }, []);
  const showAchievement = useCallback((a: AchievementLite) => {
    setQueue((q) => [...q, { kind: "achievement", ...a }]);
  }, []);
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  // Fire confetti + auto-advance whenever a new event reaches the front.
  useEffect(() => {
    if (!current) return;
    celebrate(current.kind === "achievement" ? 60 : 48);
    const t = setTimeout(dismiss, 4000);
    return () => clearTimeout(t);
  }, [current, dismiss]);

  return (
    <CelebrationContext.Provider value={{ showStreak, showAchievement }}>
      {children}
      {current && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          onClick={dismiss}
          role="dialog"
          aria-live="assertive"
        >
          <div
            className="animate-pop relative w-full max-w-xs rounded-3xl border border-[color:var(--border-accent)] bg-[var(--bg-surface)] p-8 text-center"
            style={{ boxShadow: "0 24px 70px rgba(0,0,0,0.6), var(--glow-gold)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {current.kind === "streak" ? (
              <>
                <StreakFlame days={current.days} active className="w-20 h-20 mx-auto animate-float" />
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--gold-2)]">
                  Streak extended
                </p>
                <p className="font-display text-[34px] font-extrabold text-[color:var(--gold)] tabular-nums leading-none mt-1">
                  {current.days} day{current.days === 1 ? "" : "s"}
                </p>
                <p className="text-[13px] text-[color:var(--text-secondary)] mt-2">
                  Play again tomorrow to keep it alive.
                </p>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.badge}
                  alt={current.name}
                  width={84}
                  height={84}
                  className="mx-auto animate-float"
                  style={{ width: 84, height: 84 }}
                />
                <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--purple-2)]">
                  Achievement unlocked
                </p>
                <p className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)] leading-tight mt-1">
                  {current.name}
                </p>
                <p className="text-[13px] text-[color:var(--text-secondary)] mt-1.5">{current.desc}</p>
              </>
            )}

            <button
              onClick={dismiss}
              className="mt-6 h-9 px-6 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03]"
            >
              Nice!
            </button>
          </div>
        </div>
      )}
    </CelebrationContext.Provider>
  );
}

export const useCelebration = () => useContext(CelebrationContext);
