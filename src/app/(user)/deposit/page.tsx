"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, ShieldCheck, Gift } from "lucide-react";
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
    <div className="max-w-xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/account" aria-label="Back" className="w-9 h-9 grid place-items-center rounded-full bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] hover:text-white transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-white">Deposit</h1>
        <div className="ml-auto text-right">
          <p className="v-eyebrow">Balance</p>
          <p className="text-[15px] font-extrabold text-white tabular-nums">
            {Number(balance ?? 0).toFixed(2)} <span className="text-[11px] text-[color:var(--v-text-3)]">ETB</span>
          </p>
        </div>
      </div>

      {/* Live deposit bonus, if one is running */}
      {offer && (
        <div className="rounded-[18px] border border-[color:var(--border-royal)] bg-[var(--v-amber-a12)] p-4 mb-6 flex items-start gap-3">
          <Gift className="w-5 h-5 text-[color:var(--v-amber)] shrink-0 mt-0.5" />
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
      <p className="v-eyebrow mb-3">Choose payment method</p>
      {PAYMENT_METHODS.every((m) => openRails[m.id] === false) && (
        <p className="text-[12px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2.5 mb-3">
          Deposits are paused on every method right now. Please try again later.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {PAYMENT_METHODS.map((m) => {
          // Unknown (still loading / fetch failed) counts as open — the deposit
          // route rejects a disabled rail anyway, so the worst case is one
          // wasted tap rather than a payment page that won't load.
          const open = openRails[m.id] ?? true;

          const inner = (
            <>
              <span className={cn(
                "w-12 h-12 shrink-0 rounded-[14px] bg-white grid place-items-center p-1.5",
                !open && "grayscale opacity-60",
              )}>
                <Image src={m.logo} alt={m.name} width={40} height={40} className="w-full h-full object-contain" unoptimized />
              </span>
              <div className="min-w-0 mt-3">
                <p className="text-[15px] font-bold text-white">{m.name}</p>
                <p className={cn("text-[12px] leading-snug line-clamp-2 mt-0.5", open ? "text-[color:var(--v-text-3)]" : "text-[color:var(--v-red)]")}>
                  {open ? m.desc : "Unavailable right now"}
                </p>
              </div>
            </>
          );

          return open ? (
            <Link
              key={m.id}
              href={`/deposit/${m.id}`}
              className="group relative flex flex-col rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)] p-4 text-left transition-colors hover:border-[color:var(--v-teal-a24)] v-press"
            >
              {inner}
              <ChevronRight className="absolute top-4 right-3 w-5 h-5 text-[color:var(--v-text-3)] group-hover:text-[color:var(--v-teal)] group-hover:translate-x-0.5 transition-all" />
            </Link>
          ) : (
            // Not a link at all — a disabled anchor is still tabbable and
            // followable, so the route is simply removed.
            <div
              key={m.id}
              aria-disabled="true"
              className="relative flex flex-col rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)] p-4 text-left cursor-not-allowed"
            >
              {inner}
              <span className="absolute top-4 right-3 text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-1 rounded-lg bg-[#FF3B5C12] text-[color:var(--red)] border border-[#FF3B5C33]">
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
