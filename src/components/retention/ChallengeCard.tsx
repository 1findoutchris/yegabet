"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";

/**
 * Today's challenges — three drawn from the admin-configured daily pool, live
 * progress, points paid on claim. The set rotates at 00:00 UTC on its own
 * (see pickDailyChallenges); nothing here is scheduled or stored per player.
 */

interface Challenge {
  id: string; title: string; segment: string; unit: string;
  target: number; progress: number; points: number;
  complete: boolean; claimed: boolean; claimable: boolean;
}

function fmt(n: number, unit: string) {
  return unit === "ETB" ? `ETB ${n.toLocaleString()}` : `${n} ${unit}`;
}

export function ChallengeCard() {
  const { status } = useSession();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/challenges?period=daily")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { challenges: Challenge[] } | null) => {
        if (!cancelled) { setChallenges(d?.challenges ?? []); setLoading(false); }
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
        body: JSON.stringify({ id, period: "daily" }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Couldn't claim"); return; }
      celebrate();
      toast.success(`Claimed ${d.points} points`);
      setChallenges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, claimed: true, claimable: false } : c))
      );
    } catch {
      toast.error("Network error — try again");
    } finally {
      setClaimingId(null);
    }
  }

  const totalPoints = challenges.reduce((sum, c) => sum + (c.claimed ? 0 : c.points), 0);

  return (
    <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Ticket className="w-[18px] h-[18px] text-[color:var(--gold)]" />
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">
            Today&apos;s challenges
          </h3>
        </div>
        {totalPoints > 0 && (
          <span className="text-[11px] font-semibold text-[color:var(--gold)]">{totalPoints} pts up for grabs</span>
        )}
      </div>
      <p className="text-[11px] text-[color:var(--text-muted)] mb-4">
        New set every day at 00:00 UTC. Claim each one as you finish it.
      </p>

      {status !== "authenticated" ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">Log in to track today&apos;s challenges.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading today&apos;s challenges…
        </div>
      ) : challenges.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">No challenges today — check back tomorrow.</p>
      ) : (
        <div className="space-y-2">
          {challenges.map((c) => {
            const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
            return (
              <div
                key={c.id}
                className="px-3 py-2.5 rounded-lg border"
                style={{
                  background: c.complete ? "var(--bg-accent-dim)" : "var(--bg-elevated)",
                  borderColor: c.complete ? "var(--border-accent)" : "var(--border-base)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: c.complete ? "var(--gold)" : "var(--bg-base)" }}
                  >
                    {c.complete && <Check className="w-3 h-3 text-[#09090B]" />}
                  </span>
                  <span
                    className="text-[13px] flex-1 min-w-0"
                    style={{ color: c.complete ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    {c.title}
                  </span>

                  {c.claimed ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--green)]">
                      <Check className="w-3.5 h-3.5" /> Claimed
                    </span>
                  ) : c.claimable ? (
                    <button
                      disabled={claimingId !== null}
                      onClick={() => claim(c.id)}
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-40 text-[#09090B] bg-[var(--gold)] hover:bg-[var(--gold-hover)]"
                    >
                      {claimingId === c.id && <Loader2 className="w-3 h-3 animate-spin" />}
                      Claim {c.points}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] font-semibold text-[color:var(--gold)]">{c.points} pts</span>
                  )}
                </div>

                {!c.complete && (
                  <div className="mt-2 pl-8">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-[color:var(--text-muted)]">
                        {fmt(Math.min(c.progress, c.target), c.unit)} / {fmt(c.target, c.unit)}
                      </span>
                      <span className="text-[color:var(--text-muted)]">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded bg-[var(--bg-base)] overflow-hidden">
                      <div className="h-full rounded bg-[var(--gold)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
