"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ChevronLeft, Loader2, ShieldCheck, CircleCheckBig, Wallet, Lock, Gamepad2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { PAYMENT_METHODS, type MethodId } from "@/components/account/paymentMethods";
import { DEFAULT_LIMITS, limitError } from "@/lib/paymentLimits";

interface BalanceData {
  balance: number;
  withdrawable: number;
  depositBalance: number;
  bonusBalance: number;
}

export default function WithdrawPage() {
  const { data: session, status } = useSession();
  const { openLogin } = useAuthModal();

  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<MethodId>("telebirr");
  // Which payout rails are open. Unknown = open; /api/user/withdraw rejects a
  // disabled method regardless, so this only saves a wasted submit.
  const [openRails, setOpenRails] = useState<Record<string, boolean>>({});
  // Admin-set payout band per method. Unknown = the defaults; /api/user/withdraw
  // enforces the real numbers either way.
  const [railLimits, setRailLimits] = useState<Record<string, { min: number; max: number }>>({});
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/user/balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balance?: string; withdrawable?: string; depositBalance?: string; bonusBalance?: string } | null) => {
        if (!d) return;
        setBalanceData({
          balance: parseFloat(d.balance ?? "0"),
          withdrawable: parseFloat(d.withdrawable ?? "0"),
          depositBalance: parseFloat(d.depositBalance ?? "0"),
          bonusBalance: parseFloat(d.bonusBalance ?? "0"),
        });
      })
      .catch(() => {});
  }, [status]);

  useEffect(() => {
    fetch("/api/payment-methods")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.methods) return;
        type Row = { id: string; withdrawEnabled: boolean; minWithdraw: number; maxWithdraw: number };
        const rails: Record<string, boolean> = Object.fromEntries(
          d.methods.map((m: Row) => [m.id, m.withdrawEnabled])
        );
        setOpenRails(rails);
        setRailLimits(Object.fromEntries(
          d.methods.map((m: Row) => [m.id, { min: m.minWithdraw, max: m.maxWithdraw }])
        ));
        // The default selection is telebirr; if that rail is down, move to the
        // first open one so the form isn't pre-set to something unsubmittable.
        setMethod((cur) => (rails[cur] === false
          ? (PAYMENT_METHODS.find((m) => rails[m.id] !== false)?.id ?? cur)
          : cur));
      })
      .catch(() => {});
  }, []);

  const methodOpen = (id: string) => openRails[id] ?? true;
  const selected = PAYMENT_METHODS.find((m) => m.id === method)!;
  const numAmount = Number(amount);
  const withdrawable = balanceData?.withdrawable ?? 0;
  // Deposit + bonus funds: playable, but they only become withdrawable by being
  // staked and won back.
  const locked = (balanceData?.depositBalance ?? 0) + (balanceData?.bonusBalance ?? 0);
  const limits = railLimits[method] ?? { min: DEFAULT_LIMITS.minWithdraw, max: DEFAULT_LIMITS.maxWithdraw };
  // Two ceilings: the admin's cap for this rail, and what the player actually
  // holds. Whichever bites first is what the error and the Max button use.
  const limitMsg = limitError(numAmount, "withdraw", limits);
  const amountValid = !limitMsg && numAmount <= withdrawable;
  const cashOutMax = Math.min(Math.floor(withdrawable), limits.max);
  const accountValid = account.replace(/\s+/g, "").length >= 6;
  const nameValid = accountName.trim().length >= 2;
  const canConfirm = amountValid && accountValid && nameValid && !submitting && methodOpen(method);

  const quick = [100, 250, 500, 1000].filter((q) => q <= cashOutMax && q >= limits.min);

  async function confirm() {
    if (!session) { openLogin(); return; }
    if (!canConfirm) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/user/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          amount: numAmount,
          account: account.replace(/\s+/g, ""),
          accountName: accountName.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error("Withdrawal failed", { description: data.error ?? "Please try again." });
        return;
      }

      setDone(true);
      if (data.newBalance != null) {
        // A withdrawal comes out of the withdrawable pot only, so deposit and
        // bonus are unchanged and withdrawable falls by the same amount.
        setBalanceData((prev) => prev ? {
          ...prev,
          balance: parseFloat(data.newBalance),
          withdrawable: Math.max(0, parseFloat(data.newBalance) - prev.depositBalance - prev.bonusBalance),
        } : prev);
      }
      toast.success("Withdrawal requested", { description: "Your funds are reserved while we process your payout." });
    } catch {
      toast.error("Network error", { description: "Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div
          className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-7 text-center"
          style={{ background: "linear-gradient(150deg,#141414,#141414 60%)" }}
        >
          <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full" style={{ background: "radial-gradient(circle,rgba(43,217,116,0.18),transparent 65%)" }} />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <CircleCheckBig className="w-14 h-14 text-[color:var(--green)]" />
            <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Withdrawal requested</h1>
            <p className="text-[14px] text-[color:var(--text-secondary)] max-w-sm">
              <span className="font-semibold text-[color:var(--text-primary)]">ETB {numAmount.toLocaleString()}</span> has been reserved from your balance and will be sent to your {selected.name} account once reviewed.
            </p>
            <div className="flex gap-2.5 mt-3 w-full sm:w-auto">
              <Link href="/withdrawals" className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-bold text-[14px] hover:border-[color:var(--border-accent)] transition-colors">
                View requests
              </Link>
              <Link href="/casino" className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-gold-grad text-[#09090B] font-bold text-[14px] glow-gold hover:scale-[1.01] transition-transform">
                Back to casino
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Fully locked state ─────────────────────────────────────────────────────
  if (balanceData && withdrawable === 0 && locked > 0) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/account" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Withdraw</h1>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl border border-[#F59E0B55] p-7 text-center"
          style={{ background: "linear-gradient(150deg,#1C1C1C,#141414 60%)" }}
        >
          <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full"
            style={{ background: "radial-gradient(circle,rgba(245,158,11,0.18),transparent 65%)" }} />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full grid place-items-center bg-[#F59E0B1A] border border-[#F59E0B55]">
              <Lock className="w-8 h-8 text-[#F59E0B]" />
            </div>
            <h2 className="font-display text-[20px] font-extrabold text-[color:var(--text-primary)]">No winnings yet</h2>
            <p className="text-[14px] text-[color:var(--text-secondary)] max-w-sm leading-relaxed">
              Only what you win can be withdrawn. Your deposit and bonus funds are
              ready to play with — win with them and those winnings are yours to cash out.
            </p>

            <div className="w-full rounded-2xl border border-[#F59E0B33] bg-[#F59E0B0D] px-5 py-4 mt-1">
              <div className="flex justify-between items-center text-[13px]">
                <span className="text-[color:var(--text-muted)]">Deposit funds</span>
                <span className="font-bold text-[color:var(--text-primary)] tabular-nums">
                  ETB {balanceData.depositBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center text-[13px] mt-2">
                <span className="text-[color:var(--text-muted)]">Bonus funds</span>
                <span className="font-bold text-[color:var(--purple-2)] tabular-nums">
                  ETB {balanceData.bonusBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center text-[13px] mt-2 pt-2 border-t border-[#F59E0B33]">
                <span className="text-[color:var(--text-muted)]">Ready to play</span>
                <span className="font-bold text-[#F59E0B] tabular-nums">
                  ETB {balanceData.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <Link
              href="/casino"
              className="mt-2 flex items-center gap-2 px-6 py-3 rounded-2xl bg-gold-grad text-[#09090B] font-bold text-[14px] glow-gold hover:scale-[1.01] transition-transform"
            >
              <Gamepad2 className="w-4 h-4" /> Play now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Withdraw form ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/account" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Withdraw</h1>
      </div>

      {/* Balance banner */}
      <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] px-4 py-3 mb-4">
        <Wallet className="w-5 h-5 text-[color:var(--gold)]" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Available to withdraw</p>
          <p className="font-display text-[18px] font-extrabold text-[color:var(--text-primary)] tabular-nums">
            ETB {withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
        {locked > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Play-only</p>
            <p className="text-[13px] font-bold text-[#F59E0B] tabular-nums">
              ETB {locked.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
        )}
      </div>

      {/* Play-only funds notice */}
      {locked > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#F59E0B44] bg-[#F59E0B0D] px-4 py-3 mb-5">
          <Lock className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
          <p className="text-[12px] text-[color:var(--text-secondary)] leading-relaxed">
            <span className="font-semibold text-[#F59E0B]">ETB {locked.toLocaleString(undefined, { minimumFractionDigits: 2 })} is for play only.</span>{" "}
            Your deposit and bonus funds can be played but not withdrawn — anything you win with them can.{" "}
            <Link href="/casino" className="underline text-[color:var(--gold)]">Keep playing →</Link>
          </p>
        </div>
      )}

      {/* Step 1 — Amount */}
      <Section step={1} title="Enter amount">
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
          {quick.map((q) => (
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
          {cashOutMax >= limits.min && (
            <button
              onClick={() => setAmount(String(cashOutMax))}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold border bg-[var(--bg-surface)] border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-all"
            >
              Max
            </button>
          )}
        </div>
        <p className={cn(
          "text-[11px] mt-2",
          amount !== "" && !amountValid ? "text-[color:var(--red)]" : "text-[color:var(--text-muted)]"
        )}>
          {amount !== "" && !amountValid
            ? (limitMsg
                ? `${limitMsg}.`
                : `Amount exceeds your withdrawable balance (ETB ${withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`)
            : `ETB ${limits.min.toLocaleString()} – ${limits.max.toLocaleString()} per ${selected.name} withdrawal.`}
        </p>
      </Section>

      {/* Step 2 — Method */}
      <Section step={2} title="Where to send it">
        {PAYMENT_METHODS.every((m) => !methodOpen(m.id)) && (
          <p className="text-[12px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2.5 mb-3">
            Withdrawals are paused on every method right now. Your balance is safe — please try again later.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((m) => {
            const open = methodOpen(m.id);
            return (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                disabled={!open}
                title={open ? undefined : `${m.name} withdrawals are unavailable right now`}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 transition-colors",
                  !open
                    ? "border-[color:var(--border-muted)] bg-[var(--bg-surface)] opacity-50 cursor-not-allowed"
                    : method === m.id
                      ? "border-[color:var(--gold)] bg-[var(--bg-accent-dim)]"
                      : "border-[color:var(--border-base)] bg-[var(--bg-surface)] hover:border-[color:var(--border-accent)]"
                )}
              >
                <span className={cn(
                  "w-9 h-9 rounded-lg bg-white grid place-items-center p-1 ring-1 ring-black/5",
                  !open && "grayscale",
                )}>
                  <Image src={m.logo} alt={m.name} width={28} height={28} className="w-full h-full object-contain" unoptimized />
                </span>
                <span className="text-[11px] font-semibold text-[color:var(--text-primary)] truncate max-w-full">{m.name}</span>
                {!open && (
                  <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-[color:var(--red)]">Off</span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Step 3 — Your account */}
      <Section step={3} title="Your payout account">
        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Your {selected.name} number</label>
        <input
          type="tel"
          inputMode="numeric"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="e.g. 0912 345 678"
          className="w-full h-12 px-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[15px] font-semibold focus:outline-none focus:border-[color:var(--border-accent)] transition-colors mb-3"
        />
        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Account holder name</label>
        <input
          type="text"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Full name on the account"
          className="w-full h-12 px-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[15px] font-semibold focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
        />
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
          "Log in to withdraw"
        ) : (
          <>Request withdrawal {amountValid ? `· ETB ${numAmount.toLocaleString()}` : ""}</>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mt-4">
        <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
        Withdrawals are reviewed before payout. Deposit and bonus funds must be wagered first, on
        rounds paying at least 1.1× the stake.
      </p>
    </div>
  );
}

// ── Step section wrapper ──────────────────────────────────────────────────────
function Section({ step, title, children }: {
  step: number; title: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-6 h-6 shrink-0 grid place-items-center rounded-full text-[12px] font-bold text-[#09090B] bg-gold-grad">
          {step}
        </span>
        <p className="text-[13px] font-bold text-[color:var(--text-primary)]">{title}</p>
      </div>
      {children}
    </div>
  );
}
