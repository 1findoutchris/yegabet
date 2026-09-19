"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Target, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";

interface Challenge {
  id: string; title: string; segment: string; unit: string;
  target: number; progress: number; points: number;
  complete: boolean; claimed: boolean; claimable: boolean;
}

// ETB-unit challenge amounts render in the viewer's currency; other units (spins,
// bets…) pass through unchanged. `conv` converts an ETB amount at the live rate.
function fmt(n: number, unit: string) {
  return unit === "ETB" ? `ETB ${n.toLocaleString()}` : `${n} ${unit}`;
}

export function WeeklyChallenges() {
  const { status } = useSession();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/challenges")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { challenges: Challenge[] } | null) => {
        if (!cancelled) { setChallenges(d?.challenges ?? null); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  async function claim(id: string) {
    if (claimingId !== null) return;
    setClaimingId(id);
    try {
      const res = await fetch("/api/user/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Couldn't claim"); setClaimingId(null); return; }
      celebrate();
      toast.success(`Claimed ${d.points} points`);
      setChallenges((prev) =>
        prev ? prev.map((c) => (c.id === id ? { ...c, claimed: true, claimable: false } : c)) : prev
      );
    } catch {
      toast.error("Network error — try again");
    }
    setClaimingId(null);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-[18px] h-[18px] text-[color:var(--gold)]" />
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Weekly challenges</h3>
        </div>
        <span className="text-[11px] text-[color:var(--text-muted)]">Resets Monday 00:00 UTC</span>
      </div>

      {status !== "authenticated" ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">Log in to track your weekly challenges.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading challenges…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(challenges ?? []).map((c) => {
            const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
            return (
              <div key={c.id} className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-[color:var(--text-primary)] leading-snug">{c.title}</h4>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] bg-[var(--bg-elevated)] rounded px-1.5 py-0.5">
                    {c.segment}
                  </span>
                </div>

                <div className="mt-3 mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-[color:var(--text-secondary)]">{fmt(Math.min(c.progress, c.target), c.unit)} / {fmt(c.target, c.unit)}</span>
                  <span className="font-semibold" style={{ color: c.complete ? "var(--green)" : "var(--text-muted)" }}>{pct}%</span>
                </div>
                <div className="h-1.5 rounded bg-[var(--bg-elevated)] overflow-hidden">
                  <div className="h-full rounded bg-[var(--gold)]" style={{ width: `${pct}%`, boxShadow: c.complete ? "0 0 8px var(--gold-dim)" : undefined }} />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[color:var(--gold)]">{c.points} pts</span>
                  {c.claimed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--green)]">
                      <Check className="w-3.5 h-3.5" /> Claimed
                    </span>
                  ) : (
                    <button
                      disabled={!c.claimable || claimingId !== null}
                      onClick={() => claim(c.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-[#09090B] bg-[var(--gold)] hover:bg-[var(--gold-hover)]"
                    >
                      {claimingId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Claim
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
