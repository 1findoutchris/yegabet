"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { formatCurrency } from "@/lib/utils";

interface CashbackInfo {
  tierName: string;
  ratePct: string;
  cap: number;
  netLoss: number;
  claimable: number;
  claimedThisWeek: boolean;
}

export function CashbackCard() {
  const { status } = useSession();
  const { openLogin } = useAuthModal();
  const [info, setInfo] = useState<CashbackInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/cashback")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CashbackInfo | null) => {
        if (!cancelled) { setInfo(d); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  async function claim() {
    if (claiming || !info || info.claimable <= 0 || info.claimedThisWeek) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/user/cashback", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't claim cashback");
        setClaiming(false);
        return;
      }
      celebrate();
      toast.success(`Cashback claimed — ${formatCurrency(d.claimed)} bonus`, {
        description: "Ready to play with. Win with it and the winnings are withdrawable.",
      });
      setInfo({ ...info, claimedThisWeek: true, claimable: 0 });
    } catch {
      toast.error("Network error — try again");
    }
    setClaiming(false);
  }

  const canClaim = !!info && info.claimable > 0 && !info.claimedThisWeek;

  return (
    <section
      className="relative overflow-hidden rounded-[14px] border border-[color:var(--green)]/30 p-5 sm:p-6"
      style={{ background: "linear-gradient(135deg,rgba(43,217,116,0.10),var(--bg-surface) 70%)" }}
    >
      <div className="flex items-start gap-4">
        <span className="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-[var(--green)]/15 border border-[color:var(--green)]/30">
          <Coins className="w-5 h-5 text-[color:var(--green)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-[color:var(--text-primary)]">Weekly cashback</h3>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            {info
              ? `${info.tierName} tier · ${info.ratePct} of your last-7-day net losses · up to ${formatCurrency(info.cap)}/week`
              : "A share of your net losses, back in your balance every week."}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="mt-5">
        {status !== "authenticated" ? (
          <button
            onClick={openLogin}
            className="h-10 px-5 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03]"
          >
            Log in to claim
          </button>
        ) : loading ? (
          <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your cashback…
          </div>
        ) : (
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                {info?.claimedThisWeek ? "Claimed this week" : "Available to claim"}
              </p>
              <p className="font-display text-[28px] sm:text-[34px] font-extrabold tabular-nums leading-none mt-1 text-[color:var(--green)]">
                {formatCurrency(info?.claimable ?? 0)}
              </p>
              {info && info.netLoss <= 0 && !info.claimedThisWeek && (
                <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
                  No net losses in the last 7 days — nothing to refund. 🎉
                </p>
              )}
              <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
                Paid as bonus — play with it, and your winnings are withdrawable.
              </p>
            </div>

            <button
              onClick={claim}
              disabled={!canClaim || claiming}
              className="h-10 px-5 rounded-lg text-[13px] font-bold transition-transform enabled:hover:scale-[1.03] disabled:opacity-45 disabled:cursor-not-allowed bg-[var(--green)] text-[#09090B] inline-flex items-center gap-2"
            >
              {claiming && <Loader2 className="w-4 h-4 animate-spin" />}
              {info?.claimedThisWeek ? "Claimed" : canClaim ? `Claim ${formatCurrency(info!.claimable)}` : "Nothing to claim"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
