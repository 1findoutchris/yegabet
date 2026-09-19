"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronLeft, Wallet, ChevronRight, ShieldCheck, Gift } from "lucide-react";
import { PAYMENT_METHODS } from "@/components/account/paymentMethods";
import { cn } from "@/lib/utils";

interface BonusOffer {
  rule: string;
  pct: number;
  maxEtb: number;
  minDepositEtb: number;
}

export default function DepositPage() {
  const { data: session } = useSession();
  const [balance, setBalance] = useState<string | null>(null);
  const [offer, setOffer] = useState<BonusOffer | null>(null);

  // Advertising only — approveDeposit re-quotes at credit time, so nothing here
  // can influence what a player is actually paid.
  useEffect(() => {
    fetch("/api/user/deposit-bonus")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOffer(d.offer))
      .catch(() => {});
  }, [session]);
  // Which rails are open. Undefined until loaded; on error everything stays
  // available rather than blocking deposits behind a failed config fetch.
  const [openRails, setOpenRails] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!session) return;
    fetch("/api/user/balance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBalance(d.balance))
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    fetch("/api/payment-methods")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.methods) return;
        setOpenRails(Object.fromEntries(
          d.methods.map((m: { id: string; depositEnabled: boolean }) => [m.id, m.depositEnabled])
        ));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/casino" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Deposit</h1>
        <Link href="/account" className="ml-auto text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--gold)] transition-colors">My account</Link>
      </div>

      {/* Balance */}
      <div
        className="relative overflow-hidden rounded-2xl border border-[color:var(--border-accent)] p-5 mb-6"
        style={{ background: "linear-gradient(135deg,#1A4252,#12303C)" }}
      >
        <span aria-hidden className="pointer-events-none absolute -top-14 -right-10 w-44 h-44 rounded-full" style={{ background: "radial-gradient(circle,rgba(45,212,191,0.18),transparent 65%)" }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)]">
            <Wallet className="w-5 h-5 text-[color:var(--gold)]" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Current balance</p>
            <p className="font-display text-[26px] font-extrabold text-gold-grad tabular-nums leading-none mt-0.5">
              {Number(balance ?? 0).toFixed(2)} <span className="text-[14px] text-[color:var(--text-muted)] font-bold">ETB</span>
            </p>
          </div>
        </div>
      </div>

      {/* Live deposit bonus, if one is running */}
      {offer && (
        <div className="rounded-2xl border border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)] p-4 mb-5 flex items-start gap-3">
          <Gift className="w-5 h-5 text-[color:var(--gold)] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-[color:var(--text-primary)]">
              {Math.round(offer.pct * 100)}% {offer.rule === "firstDeposit" ? "welcome bonus" : "deposit bonus"}
            </p>
            <p className="text-[12px] text-[color:var(--text-secondary)] mt-0.5">
              {offer.rule === "firstDeposit" ? "On your first deposit" : "On this deposit"}, up to{" "}
              {`ETB ${offer.maxEtb.toLocaleString()}`}
              {offer.minDepositEtb > 0 && ` · minimum ${`ETB ${offer.minDepositEtb.toLocaleString()}`}`}.
            </p>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-1">
              Added as bonus funds — play it through to unlock withdrawal.
            </p>
          </div>
        </div>
      )}

      {/* Payment method picker */}
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-3">Choose a payment method</p>
      {PAYMENT_METHODS.every((m) => openRails[m.id] === false) && (
        <p className="text-[12px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2.5 mb-3">
          Deposits are paused on every method right now. Please try again later.
        </p>
      )}
      <div className="grid gap-2.5">
        {PAYMENT_METHODS.map((m) => {
          // Unknown (still loading / fetch failed) counts as open — the deposit
          // route rejects a disabled rail anyway, so the worst case is one
          // wasted tap rather than a payment page that won't load.
          const open = openRails[m.id] ?? true;

          const inner = (
            <>
              <span className={cn(
                "w-12 h-12 shrink-0 rounded-xl bg-white grid place-items-center p-1.5 ring-1 ring-black/5",
                !open && "grayscale opacity-60",
              )}>
                <Image src={m.logo} alt={m.name} width={40} height={40} className="w-full h-full object-contain" unoptimized />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-[color:var(--text-primary)]">{m.name}</p>
                <p className={cn("text-[12px] truncate", open ? "text-[color:var(--text-muted)]" : "text-[color:var(--red)]")}>
                  {open ? m.desc : `${m.name} deposits are unavailable right now`}
                </p>
              </div>
            </>
          );

          return open ? (
            <Link
              key={m.id}
              href={`/deposit/${m.id}`}
              className="group flex items-center gap-3 rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-3 text-left transition-all duration-150 hover:border-[color:var(--border-accent)] press"
            >
              {inner}
              <ChevronRight className="ml-auto w-5 h-5 text-[color:var(--text-muted)] group-hover:text-[color:var(--gold)] transition-colors shrink-0" />
            </Link>
          ) : (
            // Not a link at all — a disabled anchor is still tabbable and
            // followable, so the route is simply removed.
            <div
              key={m.id}
              aria-disabled="true"
              className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-muted)] bg-[var(--bg-surface)] p-3 text-left cursor-not-allowed"
            >
              {inner}
              <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-1 rounded-lg bg-[#FF3B5C12] text-[color:var(--red)] border border-[#FF3B5C33]">
                Off
              </span>
            </div>
          );
        })}
      </div>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mt-6">
        <ShieldCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
        Manual transfer · confirmed from your transaction SMS
      </p>
    </div>
  );
}
