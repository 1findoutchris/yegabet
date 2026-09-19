"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Lock, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { StreakFlame } from "./StreakArt";
import { formatCurrency } from "@/lib/utils";

interface Milestone {
  day: number; reward: string; points: number; etb: number;
  reached: boolean; claimed: boolean; claimable: boolean;
}
interface StreakData {
  streakDays: number;
  milestones: Milestone[];
}

const GRID_DAYS = 14;

export function StreakBoard() {
  const { status } = useSession();
  const { openLogin } = useAuthModal();
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimingDay, setClaimingDay] = useState<number | null>(null);

  useEffect(() => {
    if (status !== "authenticated") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/streak")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StreakData | null) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  async function claim(day: number) {
    if (claimingDay !== null) return;
    setClaimingDay(day);
    try {
      const res = await fetch("/api/user/streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't claim milestone");
        setClaimingDay(null);
        return;
      }
      celebrate();
      const parts = [];
      if (d.points) parts.push(`${d.points} pts`);
      if (d.etb) parts.push(`${formatCurrency(d.etb)} bonus`);
      toast.success(`Claimed ${parts.join(" + ")}`, {
        description: d.bonus
          ? "Bonus is ready to play with — winnings are withdrawable"
          : undefined,
      });
      setData((prev) =>
        prev
          ? { ...prev, milestones: prev.milestones.map((m) => (m.day === day ? { ...m, claimed: true, claimable: false } : m)) }
          : prev
      );
    } catch {
      toast.error("Network error — try again");
    }
    setClaimingDay(null);
  }

  const streakDays = data?.streakDays ?? 0;

  return (
    <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5 sm:p-6">
      {/* Counter */}
      <div className="flex items-center gap-4">
        <StreakFlame days={streakDays} active={streakDays > 0} className="w-12 h-12 shrink-0" />
        <div>
          <div className="flex items-end gap-2">
            <span className="font-display text-[44px] font-extrabold text-[color:var(--gold)] tabular-nums leading-none">
              {streakDays}
            </span>
            <span className="text-[14px] font-semibold text-[color:var(--text-secondary)] pb-1">
              day{streakDays === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-1">Play once a day to keep your streak alive</p>
        </div>
      </div>

      {/* Logged-out / loading */}
      {status !== "authenticated" ? (
        <button
          onClick={openLogin}
          className="mt-5 h-10 px-5 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03]"
        >
          Log in to start your streak
        </button>
      ) : loading ? (
        <div className="mt-5 flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your streak…
        </div>
      ) : (
        <>
          {/* 14-day grid */}
          <div className="mt-5 grid grid-cols-7 gap-1.5">
            {Array.from({ length: GRID_DAYS }).map((_, i) => {
              const day = i + 1;
              const done = day <= streakDays;
              const isToday = day === streakDays;
              return (
                <div
                  key={day}
                  className="aspect-square rounded-md flex items-center justify-center text-[11px] font-semibold border"
                  style={{
                    background: done ? "var(--bg-accent-dim)" : "var(--bg-elevated)",
                    borderColor: isToday ? "var(--gold)" : done ? "var(--border-accent)" : "var(--border-base)",
                    color: done ? "var(--gold)" : "var(--text-muted)",
                  }}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : day}
                </div>
              );
            })}
          </div>

          {/* Milestones */}
          <div className="mt-6 space-y-2">
            {(data?.milestones ?? []).map((m) => (
              <div
                key={m.day}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
                style={{
                  background: m.reached ? "var(--bg-accent-dim)" : "var(--bg-elevated)",
                  borderColor: m.reached ? "var(--border-accent)" : "var(--border-base)",
                }}
              >
                <span
                  className="shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[12px] font-bold"
                  style={{ background: "var(--bg-base)", color: m.reached ? "var(--gold)" : "var(--text-muted)" }}
                >
                  D{m.day}
                </span>
                <span className="flex-1 text-[12px] text-[color:var(--text-secondary)]">{m.reward}</span>
                {m.claimed ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--green)]">
                    <Check className="w-3.5 h-3.5" /> Claimed
                  </span>
                ) : m.claimable ? (
                  <button
                    onClick={() => claim(m.day)}
                    disabled={claimingDay !== null}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#09090B] bg-[var(--gold)] hover:bg-[var(--gold-hover)] rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50"
                  >
                    {claimingDay === m.day ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gift className="w-3 h-3" />}
                    Claim
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-muted)]">
                    <Lock className="w-3.5 h-3.5" /> Day {m.day}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
