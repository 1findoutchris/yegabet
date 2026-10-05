"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MissionCard, type Mission } from "@/components/vinna/MissionCard";
import { SkeletonMission } from "@/components/vinna/Skeleton";
import { SectionHeader } from "@/components/vinna/SectionHeader";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";

/**
 * Today's challenges — three drawn from the admin-configured daily pool, live
 * progress, points paid on claim. The set rotates at 00:00 UTC on its own
 * (see pickDailyChallenges); nothing here is scheduled or stored per player.
 */

type Challenge = Mission;


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
      toast.success(`+${d.points} XP claimed`);
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
    <section>
      <SectionHeader
        title="Daily missions"
        description={totalPoints > 0 ? `${totalPoints} XP up for grabs · new set at 00:00 UTC` : "New set every day at 00:00 UTC"}
      />

      {status !== "authenticated" ? (
        <p className="text-[13px] text-[color:var(--v-text-3)]">Log in to track today&apos;s missions.</p>
      ) : loading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <SkeletonMission key={i} />)}</div>
      ) : challenges.length === 0 ? (
        <p className="text-[13px] text-[color:var(--v-text-3)] v-surface p-4">No missions today. Check back tomorrow.</p>
      ) : (
        <div className="grid gap-3">
          {challenges.map((c) => (
            <MissionCard key={c.id} mission={c} onClaim={claim} claiming={claimingId === c.id} disabled={claimingId !== null} />
          ))}
        </div>
      )}
    </section>
  );
}
