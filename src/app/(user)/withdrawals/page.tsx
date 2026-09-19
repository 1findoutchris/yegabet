"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ChevronLeft, ArrowUpRight, Loader2, Wallet, Clock, CircleCheckBig, XCircle, Ban,
  KeyRound, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useBalance } from "@/contexts/BalanceContext";
import { PAYMENT_METHODS } from "@/components/account/paymentMethods";

interface WithdrawalRequest {
  id: string;
  publicId: string | null;
  amount: number;
  method: string;
  account: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "CANCELLED";
  adminNote: string | null;
  createdAt: string;
  agentCode: string | null;
  proofUrl: string | null;
}

const STATUS_META: Record<
  WithdrawalRequest["status"],
  { label: string; color: string; icon: typeof Clock }
> = {
  PENDING:    { label: "Pending",   color: "#F5B400", icon: Clock },
  // An agent has committed to sending the money — no longer cancellable.
  PROCESSING: { label: "Sending",   color: "#F59E0B", icon: Clock },
  APPROVED:   { label: "Paid out",  color: "#2BD974", icon: CircleCheckBig },
  REJECTED:   { label: "Rejected",  color: "#FF3B5C", icon: XCircle },
  CANCELLED:  { label: "Cancelled", color: "#A79FB5", icon: Ban },
};

function methodName(id: string) {
  return PAYMENT_METHODS.find((m) => m.id === id)?.name ?? id;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function WithdrawalsPage() {
  const { data: session, status } = useSession();
  const { openLogin } = useAuthModal();
  const { refresh } = useBalance();

  const [requests, setRequests] = useState<WithdrawalRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null); // request id whose code is shown
  const [copied, setCopied] = useState(false);
  const [proof, setProof] = useState<string | null>(null); // lightbox image url

  const load = useCallback(() => {
    return fetch("/api/user/withdraw")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { requests?: WithdrawalRequest[] } | null) => {
        if (d?.requests) setRequests(d.requests);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { setLoading(false); return; }
    load().finally(() => setLoading(false));
  }, [session, status, load]);

  async function cancel(id: string) {
    setCancelling(id);
    try {
      const res = await fetch(`/api/user/withdraw/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Couldn't cancel", { description: data.error ?? "Please try again." });
        // Status may have changed under us (e.g. just approved) — re-sync.
        load();
        return;
      }
      setRequests((prev) =>
        prev?.map((r) => (r.id === id ? { ...r, status: "CANCELLED", adminNote: "Cancelled by user" } : r)) ?? prev
      );
      refresh();
      toast.success("Withdrawal cancelled", { description: "Your funds have been returned to your balance." });
    } catch {
      toast.error("Network error", { description: "Check your connection and try again." });
    } finally {
      setCancelling(null);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  // ── Logged out ─────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] grid place-items-center mx-auto mb-4">
          <ArrowUpRight className="w-6 h-6 text-[color:var(--gold)]" />
        </div>
        <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Withdrawal requests</h1>
        <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 mb-5">Log in to view and manage your withdrawals.</p>
        <button onClick={openLogin} className="px-6 py-3 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm glow-gold hover:scale-[1.02] transition-transform">
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/account" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Withdrawal requests</h1>
      </div>

      {requests && requests.length > 0 ? (
        <div className="flex flex-col gap-3">
          {requests.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.PENDING;
            const Icon = meta.icon;
            const isCancelling = cancelling === r.id;
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: `${meta.color}1A` }}>
                    <Icon className="w-5 h-5" style={{ color: meta.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">
                      {methodName(r.method)} · {r.account}
                    </p>
                    <p className="text-[11px] text-[color:var(--text-muted)]">
                      {fmtDate(r.createdAt)}
                      {r.publicId && (
                        <>
                          {" · "}
                          <span className="font-mono font-semibold text-[color:var(--gold)]">{r.publicId}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-col items-end shrink-0">
                    <p className="font-bold text-[15px] tabular-nums text-[color:var(--text-primary)]">
                      {Number(r.amount).toLocaleString()} <span className="text-[11px] text-[color:var(--text-muted)] font-medium">ETB</span>
                    </p>
                    <span
                      className="inline-flex items-center gap-1 mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]"
                      style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}55` }}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>

                {/* Admin note for rejected requests */}
                {r.status === "REJECTED" && r.adminNote && (
                  <p className="px-4 pb-3 -mt-1 text-[12px] text-[color:var(--text-secondary)]">{r.adminNote}</p>
                )}

                {/* Payment proof (approved) — auto-removed after 2 days */}
                {r.proofUrl && (
                  <div className="px-4 pb-3.5 -mt-1">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Payment proof</p>
                    <button onClick={() => setProof(r.proofUrl)} className="block rounded-xl overflow-hidden border border-[color:var(--border-base)] press">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.proofUrl} alt="Payment proof" className="w-full max-h-48 object-cover" />
                    </button>
                    <p className="text-[10px] text-[color:var(--text-muted)] mt-1">Tap to enlarge · available for 2 days</p>
                  </div>
                )}

                {/* Agent code — send it to the agent to get paid */}
                {r.agentCode && (
                  <div className="px-4 pb-3.5 -mt-1">
                    {revealed === r.id ? (
                      <button
                        onClick={() => { navigator.clipboard.writeText(r.agentCode!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                        className="w-full h-11 rounded-xl border border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)] flex items-center justify-center gap-3 text-[color:var(--text-primary)]"
                      >
                        <span className="font-display text-[20px] font-extrabold tracking-[0.3em] text-gold-grad tabular-nums">{r.agentCode}</span>
                        <span className="text-[color:var(--text-muted)]">{copied ? <Check className="w-4 h-4 text-[color:var(--green)]" /> : <Copy className="w-4 h-4" />}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => { setRevealed(r.id); setCopied(false); }}
                        className="w-full h-11 rounded-xl border border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--border-accent)] text-[13px] font-bold flex items-center justify-center gap-2 transition-colors"
                      >
                        <KeyRound className="w-4 h-4" /> Get code
                      </button>
                    )}
                    <p className="text-[11px] text-[color:var(--text-muted)] text-center mt-1.5">Send this code to the agent to receive your payout.</p>
                  </div>
                )}

                {/* The cancel button is gone at this point — say why, so its
                    disappearance doesn't read as a bug. */}
                {r.status === "PROCESSING" && (
                  <p className="px-4 pb-3.5 -mt-1 text-[12px] text-[color:var(--text-secondary)]">
                    An agent is sending your money now — this can no longer be cancelled.
                  </p>
                )}

                {/* Cancel — only while pending */}
                {r.status === "PENDING" && (
                  <div className="px-4 pb-3.5 -mt-1">
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={isCancelling}
                      className={cn(
                        "w-full h-11 rounded-xl border text-[13px] font-bold flex items-center justify-center gap-2 transition-colors",
                        isCancelling
                          ? "border-[color:var(--border-base)] text-[color:var(--text-muted)] cursor-not-allowed"
                          : "border-[#FF3B5C44] text-[color:var(--red)] hover:bg-[#FF3B5C12]"
                      )}
                    >
                      {isCancelling
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</>
                        : <><Ban className="w-4 h-4" /> Cancel request</>}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] grid place-items-center mx-auto mb-3">
            <Wallet className="w-5 h-5 text-[color:var(--text-muted)]" />
          </div>
          <p className="text-[13px] text-[color:var(--text-muted)]">No withdrawal requests yet</p>
          <Link href="/withdraw" className="inline-block mt-3 text-[13px] font-semibold text-[color:var(--gold)]">
            Request a withdrawal →
          </Link>
        </div>
      )}

      <p className="text-[11px] text-[color:var(--text-muted)] mt-5 text-center leading-relaxed">
        You can cancel a request while it&apos;s still pending — the reserved funds go straight back to your balance.
        Once a payout is approved it can no longer be cancelled.
      </p>

      {/* Proof lightbox */}
      {proof && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85" onClick={() => setProof(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proof} alt="Payment proof" className="max-w-full max-h-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
