"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Sparkles, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { celebrate } from "@/lib/celebrate";
import { quoteRedemption } from "@/lib/retention";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useBalance } from "@/contexts/BalanceContext";
import { formatCurrency } from "@/lib/utils";

interface RedeemInfo {
  pointsBalance: number;
  pointsPerEtb: number;
  minRedeemPoints: number;
  maxPoints: number;
  maxEtb: number;
}

/** Up to four spend amounts, largest last. Multiples of the minimum, capped by
 *  what the player can actually afford, always including their max. */
function presets(info: RedeemInfo): number[] {
  const { minRedeemPoints: min, maxPoints } = info;
  const candidates = [min, min * 2, min * 5, maxPoints].filter((p) => p > 0 && p <= maxPoints);
  return [...new Set(candidates)].sort((a, b) => a - b);
}

export function RedeemPoints() {
  const { status } = useSession();
  const { openLogin } = useAuthModal();
  const { refresh } = useBalance();
  const [info, setInfo] = useState<RedeemInfo | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/points/redeem")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RedeemInfo | null) => {
        if (cancelled) return;
        setInfo(d);
        // Preselect the smallest affordable amount so the CTA is one tap.
        setSelected(d && d.maxPoints > 0 ? presets(d)[0] ?? null : null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  // Same rule the server enforces — the button greys out for the same reason
  // the API would reject it.
  const priced =
    info && selected !== null
      ? quoteRedemption(selected, info.pointsBalance, info.pointsPerEtb, info.minRedeemPoints)
      : null;
  const canRedeem = !!priced?.ok && !redeeming;

  async function redeem() {
    if (!info || !priced?.ok || redeeming) return;
    setRedeeming(true);
    try {
      const res = await fetch("/api/user/points/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: priced.quote.points }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Couldn't redeem points");
        setRedeeming(false);
        return;
      }
      celebrate();
      toast.success(`Redeemed for ${formatCurrency(d.etb)} bonus`, {
        description: "Ready to play with. Win with it and the winnings are withdrawable.",
      });
      const pointsBalance: number = d.pointsBalance;
      const next: RedeemInfo = {
        ...info,
        pointsBalance,
        maxPoints: Math.floor(pointsBalance / info.pointsPerEtb) * info.pointsPerEtb,
        maxEtb: Math.floor(pointsBalance / info.pointsPerEtb),
      };
      if (next.maxPoints < info.minRedeemPoints) next.maxPoints = 0;
      setInfo(next);
      setSelected(next.maxPoints > 0 ? presets(next)[0] ?? null : null);
      refresh(); // nav points chip + bonus position
    } catch {
      toast.error("Network error — try again");
    }
    setRedeeming(false);
  }

  const options = info ? presets(info) : [];

  return (
    <section
      className="relative overflow-hidden rounded-[14px] border border-[color:var(--purple-2)]/30 p-5 sm:p-6"
      style={{ background: "linear-gradient(135deg,rgba(167,139,250,0.10),var(--bg-surface) 70%)" }}
    >
      <div className="flex items-start gap-4">
        <span className="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-[var(--purple-2)]/15 border border-[color:var(--purple-2)]/30">
          <Sparkles className="w-5 h-5 text-[color:var(--purple-2)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-[color:var(--text-primary)]">Redeem points</h3>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            {info
              ? `${info.pointsPerEtb} points = ${formatCurrency(1)} bonus · spending points never changes your tier`
              : "Turn the points you earn on every bet into bonus credit."}
          </p>
        </div>
      </div>

      <div className="mt-5">
        {status !== "authenticated" ? (
          <button
            onClick={openLogin}
            className="h-10 px-5 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03]"
          >
            Log in to redeem
          </button>
        ) : loading ? (
          <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your points…
          </div>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
              Points to spend
            </p>
            <p className="font-display text-[28px] sm:text-[34px] font-extrabold tabular-nums leading-none mt-1 text-[color:var(--purple-2)]">
              {(info?.pointsBalance ?? 0).toLocaleString()}
            </p>

            {options.length === 0 ? (
              <p className="text-[11px] text-[color:var(--text-muted)] mt-2">
                Earn {(((info?.minRedeemPoints ?? 0) - (info?.pointsBalance ?? 0)) || 0).toLocaleString()} more
                points to make your first redemption — you need{" "}
                {(info?.minRedeemPoints ?? 0).toLocaleString()} to redeem.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mt-4">
                  {options.map((p) => (
                    <button
                      key={p}
                      onClick={() => setSelected(p)}
                      className={`h-9 px-3.5 rounded-lg text-[12px] font-semibold tabular-nums border transition-colors ${
                        selected === p
                          ? "bg-[var(--purple-2)]/20 border-[color:var(--purple-2)] text-[color:var(--text-primary)]"
                          : "bg-[var(--bg-elevated)] border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)]"
                      }`}
                    >
                      {p.toLocaleString()}
                      {p === info?.maxPoints && options.length > 1 ? " · max" : ""}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex items-end justify-between gap-4 flex-wrap">
                  <p className="text-[11px] text-[color:var(--text-muted)] inline-flex items-start gap-1.5 max-w-xs">
                    <Lock className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>
                      Paid as <strong className="font-semibold text-[color:var(--text-secondary)]">bonus funds</strong> —
                      playable straight away, and anything you win with them is withdrawable.
                    </span>
                  </p>

                  <button
                    onClick={redeem}
                    disabled={!canRedeem}
                    className="h-10 px-5 rounded-lg text-[13px] font-bold transition-transform enabled:hover:scale-[1.03] disabled:opacity-45 disabled:cursor-not-allowed bg-[var(--purple-2)] text-[#09090B] inline-flex items-center gap-2"
                  >
                    {redeeming && <Loader2 className="w-4 h-4 animate-spin" />}
                    {priced?.ok ? `Redeem for ${formatCurrency(priced.quote.etb)}` : priced?.error ?? "Select an amount"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
