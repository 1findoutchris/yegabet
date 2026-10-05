"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MissionCard, type Mission } from "@/components/vinna/MissionCard";
import { SkeletonMission } from "@/components/vinna/Skeleton";
import { SectionHeader } from "@/components/vinna/SectionHeader";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";

type Challenge = Mission;


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
      toast.success(`+${d.points} XP claimed`);
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
      <SectionHeader title="Weekly missions" description="Resets Monday 00:00 UTC" />

      {status !== "authenticated" ? (
        <p className="text-[13px] text-[color:var(--v-text-3)]">Log in to track your weekly missions.</p>
      ) : loading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <SkeletonMission key={i} />)}</div>
      ) : (challenges ?? []).length === 0 ? (
        <p className="text-[13px] text-[color:var(--v-text-3)] v-surface p-4">No weekly missions right now.</p>
      ) : (
        <div className="grid gap-3">
          {(challenges ?? []).map((c) => (
            <MissionCard key={c.id} mission={c} onClaim={claim} claiming={claimingId === c.id} disabled={claimingId !== null} />
          ))}
        </div>
      )}
    </section>
  );
}
