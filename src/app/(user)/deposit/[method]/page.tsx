"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ChevronLeft, Copy, Check, Loader2, ShieldCheck, CircleCheckBig,
  MessageSquareText, Clock, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { getPaymentMethod } from "@/components/account/paymentMethods";
import { DEFAULT_LIMITS, limitError } from "@/lib/paymentLimits";

const QUICK = [100, 250, 500, 1000, 2500, 5000];
// Poll for approval for up to 10 minutes before giving up

type DepositState =
  | { phase: "form" }
  | { phase: "pending"; depositId: string; amount: number }
  | { phase: "approved"; amount: number }
  | { phase: "review" };  // timed out, under manual review

export default function DepositMethodPage() {
  const params = useParams<{ method: string }>();
  const method = getPaymentMethod(params.method);

  const { data: session } = useSession();
  const { openLogin } = useAuthModal();

  const [amount, setAmount]     = useState("");
  const [sms, setSms]           = useState("");
  const [copied, setCopied]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState]       = useState<DepositState>({ phase: "form" });
  // Admin-editable agent details (falls back to the static config below)
  const [agent, setAgent] = useState<{ agentNumber: string; agentName: string } | null>(null);
  // null = not yet known. Fails open on error; /api/user/deposit rejects a
  // disabled rail regardless, so this is presentation only.
  const [depositOpen, setDepositOpen] = useState<boolean | null>(null);
  // Admin-set amount band. Same story — the route enforces it, this just saves
  // the player a rejected submit.
  const [limits, setLimits] = useState({
    min: DEFAULT_LIMITS.minDeposit,
    max: DEFAULT_LIMITS.maxDeposit,
  });

  const esRef = useRef<EventSource | null>(null);

  // Close SSE on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  // Load the current agent number / name for this method.
  // `agent` stays null until resolved, so the UI can show a skeleton instead
  // of flashing the static placeholder. On error we fall back to the static
  // config so the deposit flow is never blocked.
  useEffect(() => {
    if (!method) return;
    let cancelled = false;
    const fallback = { agentNumber: method.agentNumber, agentName: method.agentName };
    fetch("/api/payment-methods")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const m = d?.methods?.find((x: { id: string }) => x.id === method.id);
        setAgent(m ? { agentNumber: m.agentNumber, agentName: m.agentName } : fallback);
        setDepositOpen(m ? m.depositEnabled !== false : true);
        if (m?.minDeposit != null) setLimits({ min: m.minDeposit, max: m.maxDeposit });
      })
      .catch(() => { if (!cancelled) { setAgent(fallback); setDepositOpen(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method?.id]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  // Open SSE stream once we have a depositId — server pushes the moment it's approved
  useEffect(() => {
    if (state.phase !== "pending") return;
    const { depositId, amount: amt } = state;

    const es = new EventSource(`/api/user/deposit/${depositId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as { type: string; amount?: number };
      if (data.type === "approved") {
        es.close();
        setState({ phase: "approved", amount: data.amount ?? amt });
        // The global balance stream fires the "Deposit approved" toast.
      } else if (data.type === "timeout") {
        es.close();
        setState({ phase: "review" });
      }
    };

    es.onerror = () => {
      es.close();
      // Connection dropped — fall back to "under review" so the user isn't stuck
      setState((s) => s.phase === "pending" ? { phase: "review" } : s);
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  if (!method) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-[color:var(--text-secondary)] mb-4">That payment method doesn&apos;t exist.</p>
        <Link href="/deposit" className="text-[color:var(--gold)] font-semibold hover:text-[color:var(--gold-hover)]">← Back to deposit</Link>
      </div>
    );
  }

  // Admin took this rail down — still reachable by a direct link or stale tab.
  if (depositOpen === false) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-[17px] font-bold text-[color:var(--text-primary)] mb-1.5">
          {method.name} deposits are unavailable
        </p>
        <p className="text-[13px] text-[color:var(--text-secondary)] mb-5">
          This payment method is switched off right now. Please pick another — your balance is unaffected.
        </p>
        <Link href="/deposit" className="text-[color:var(--gold)] font-semibold hover:text-[color:var(--gold-hover)]">
          ← Choose another method
        </Link>
      </div>
    );
  }

  const numAmount  = Number(amount);
  const amountError = limitError(numAmount, "deposit", limits);
  const amountValid = !amountError;
  const smsValid   = sms.trim().length >= 12;
  const canConfirm = amountValid && smsValid && !submitting;

  // Agent details load from the API; null = still loading (show skeleton)
  const agentLoading = agent === null;
  const agentNumber  = agent?.agentNumber ?? "";
  const agentName    = agent?.agentName ?? "";

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(agentNumber.replace(/\s+/g, ""));
      setCopied(true);
    } catch {
      toast.error("Couldn't copy", { description: "Copy the number manually." });
    }
  }

  async function confirm() {
    if (!session) { openLogin(); return; }
    if (!canConfirm) return;
    setSubmitting(true);

    try {
      const res  = await fetch("/api/user/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: method!.id, amount: numAmount, receiptText: sms }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error("Deposit failed", { description: data.error ?? "Please try again." });
        return;
      }

      if (data.status === "APPROVED") {
        setState({ phase: "approved", amount: numAmount });
        // The global balance stream fires the "Deposit approved" toast.
      } else {
        setState({ phase: "pending", depositId: data.depositId, amount: numAmount });
        toast.info("Verifying transfer…", {
          description: "We&apos;re matching your SMS reference. This usually takes under a minute.",
        });
      }
    } catch {
      toast.error("Network error", { description: "Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (state.phase === "approved") {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div
          className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-7 text-center"
          style={{ background: "linear-gradient(150deg,#12303C,#12303C 60%)" }}
        >
          <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full"
            style={{ background: "radial-gradient(circle,rgba(43,217,116,0.18),transparent 65%)" }} />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <CircleCheckBig className="w-14 h-14 text-[color:var(--green)]" />
            <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Deposit approved!</h1>
            <p className="text-[14px] text-[color:var(--text-secondary)] max-w-sm">
              <span className="font-semibold text-[color:var(--text-primary)]">ETB {state.amount.toLocaleString()}</span> has been added to your balance.
            </p>
            <div className="flex gap-2.5 mt-3 w-full sm:w-auto">
              <Link href="/account" className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-bold text-[14px] hover:border-[color:var(--border-accent)] transition-colors">
                My account
              </Link>
              <Link href="/casino" className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-gold-grad text-[#09090B] font-bold text-[14px] glow-gold hover:scale-[1.01] transition-transform">
                Play now
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Pending state ──────────────────────────────────────────────────────────
  if (state.phase === "pending") {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div
          className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-7 text-center"
          style={{ background: "linear-gradient(150deg,#12303C,#12303C 60%)" }}
        >
          <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full"
            style={{ background: "radial-gradient(circle,rgba(45,212,191,0.14),transparent 65%)" }} />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full border-2 border-[color:var(--gold)] grid place-items-center">
              <Loader2 className="w-7 h-7 text-[color:var(--gold)] animate-spin" />
            </div>
            <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Verifying transfer…</h1>
            <p className="text-[14px] text-[color:var(--text-secondary)] max-w-sm">
              We&apos;re matching your <span className="font-semibold text-[color:var(--text-primary)]">ETB {state.amount.toLocaleString()}</span> {method.name} transfer.
              This usually takes under a minute once the SMS is forwarded.
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
              <Clock className="w-3.5 h-3.5" /> Checking every few seconds…
            </div>
            <div className="flex gap-2.5 mt-4 w-full sm:w-auto">
              <Link href="/casino" className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-bold text-[14px] hover:border-[color:var(--border-accent)] transition-colors">
                Play while waiting
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Under review (timed out) ───────────────────────────────────────────────
  if (state.phase === "review") {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div
          className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-7 text-center"
          style={{ background: "linear-gradient(150deg,#12303C,#12303C 60%)" }}
        >
          <div className="flex flex-col items-center gap-3">
            <Clock className="w-14 h-14 text-[color:var(--text-muted)]" />
            <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Under review</h1>
            <p className="text-[14px] text-[color:var(--text-secondary)] max-w-sm">
              Your deposit is being reviewed manually. You&apos;ll be notified once it&apos;s approved — usually within a few hours.
            </p>
            <Link href="/account" className="mt-2 px-5 py-3 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-bold text-[14px] hover:border-[color:var(--border-accent)] transition-colors">
              View in My Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Deposit form ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/deposit" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <span className="w-9 h-9 shrink-0 rounded-xl bg-white grid place-items-center p-1 ring-1 ring-black/5">
          <Image src={method.logo} alt={method.name} width={32} height={32} className="w-full h-full object-contain" unoptimized />
        </span>
        <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">{method.name} deposit</h1>
      </div>

      {/* Step 1 — Amount */}
      <Section step={1} title="Enter amount" accent={method.accent}>
        <div className="relative mb-3">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] font-bold text-[15px]">ETB</span>
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full h-14 pl-14 pr-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[22px] font-extrabold tabular-nums focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.filter((q) => q >= limits.min && q <= limits.max).map((q) => (
            <button
              key={q}
              onClick={() => setAmount(String(q))}
              className={cn(
                "px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 border",
                numAmount === q
                  ? "bg-[var(--bg-accent-dim)] border-[color:var(--gold)] text-[color:var(--gold)]"
                  : "bg-[var(--bg-surface)] border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]"
              )}
            >
              {q.toLocaleString()}
            </button>
          ))}
        </div>
        <p className={cn(
          "text-[11px] mt-2",
          amount !== "" && amountError ? "text-[color:var(--red)]" : "text-[color:var(--text-muted)]"
        )}>
          {amount !== "" && amountError
            ? `${amountError}.`
            : `ETB ${limits.min.toLocaleString()} – ${limits.max.toLocaleString()} per deposit.`}
        </p>
      </Section>

      {/* Step 2 — Send to agent */}
      <Section step={2} title="Send the money" accent={method.accent}>
        <p className="text-[13px] text-[color:var(--text-secondary)] mb-3">
          Transfer {amountValid ? <span className="font-bold text-[color:var(--text-primary)]">ETB {numAmount.toLocaleString()}</span> : "the amount"} to the {method.name} account below, then paste the confirmation SMS.
        </p>
        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: `${method.accent}55`, background: `${method.accent}12` }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">{method.agentLabel}</p>
              {agentLoading ? (
                <span className="vinna-skeleton block h-[26px] w-40 rounded-md mt-1" />
              ) : (
                <p className="font-display text-[22px] font-extrabold tabular-nums text-[color:var(--text-primary)] leading-tight mt-0.5">{agentNumber}</p>
              )}
            </div>
            <button
              onClick={copyNumber}
              disabled={agentLoading}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
              style={{ background: method.accent }}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-[color:var(--border-muted)] flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Account name</p>
            {agentLoading ? (
              <span className="vinna-skeleton block h-[18px] w-28 rounded-md" />
            ) : (
              <p className="text-[14px] font-semibold text-[color:var(--text-primary)] truncate">{agentName}</p>
            )}
          </div>
        </div>

        {/* Rail-specific caution, read at the moment of transferring rather than
            buried in help text — this is where the mistake gets made. */}
        {method.warning && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#F59E0B55] bg-[#F59E0B14] px-3.5 py-3"
          >
            <TriangleAlert className="w-4 h-4 shrink-0 text-[#F59E0B] mt-0.5" />
            <p className="text-[12px] leading-relaxed text-[color:var(--text-secondary)]">
              {method.warning}
            </p>
          </div>
        )}
      </Section>

      {/* Step 3 — Paste SMS */}
      <Section step={3} title="Paste your transaction SMS" accent={method.accent}>
        <div className="relative">
          <MessageSquareText className="absolute left-3 top-3 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
          <textarea
            value={sms}
            onChange={(e) => setSms(e.target.value)}
            rows={5}
            placeholder={`Paste the full ${method.name} confirmation SMS here — e.g. "You have transferred ETB ${amountValid ? numAmount.toLocaleString() : "500"} to ${agentName}. Ref ..."`}
            className="w-full resize-none rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] leading-relaxed pl-9 pr-3 py-3 focus:outline-none focus:border-[color:var(--border-accent)] transition-colors placeholder:text-[color:var(--text-muted)]"
          />
        </div>
        <p className="text-[11px] text-[color:var(--text-muted)] mt-2">Paste the complete message so we can match the reference number.</p>
      </Section>

      {/* Confirm */}
      <button
        onClick={confirm}
        disabled={!!session && !canConfirm}
        className={cn(
          "w-full py-4 rounded-2xl font-bold text-[15px] transition-all duration-150 flex items-center justify-center gap-2",
          session && !canConfirm
            ? "bg-[var(--bg-elevated)] text-[color:var(--text-muted)] cursor-not-allowed"
            : "bg-gold-grad text-[#09090B] glow-gold hover:scale-[1.01]"
        )}
      >
        {submitting ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
        ) : !session ? (
          "Log in to deposit"
        ) : (
          <>Confirm deposit {amountValid ? `· ETB ${numAmount.toLocaleString()}` : ""}</>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mt-4">
        <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
        Your transfer is verified before funds are credited
      </p>
    </div>
  );
}

// ── Step section wrapper ──────────────────────────────────────────────────────
function Section({ step, title, accent, children }: {
  step: number; title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="w-6 h-6 shrink-0 grid place-items-center rounded-full text-[12px] font-bold text-white"
          style={{ background: accent }}
        >
          {step}
        </span>
        <p className="text-[13px] font-bold text-[color:var(--text-primary)]">{title}</p>
      </div>
      {children}
    </div>
  );
}
