"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpRight, ArrowDownLeft, History, RotateCw, Clock } from "lucide-react";
import { useBalance } from "@/contexts/BalanceContext";
import { StreakFlame } from "@/components/retention/StreakArt";
import { BottomSheet } from "./BottomSheet";

const fmt = (v: string | number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The header balance capsule. The amount opens the wallet sheet; the "+" end
 * is the contextual deposit action (the old centre Deposit button is gone).
 * Every figure comes from BalanceContext, which the wallet SSE stream keeps
 * live, so a settled bet or approved deposit moves the number on its own.
 */
export function WalletWidget() {
  const { balance, depositBalance, bonusBalance, withdrawable, streakDays, refresh } = useBalance();
  const [open, setOpen] = useState(false);
  const shown = fmt(balance);
  const playOnly = Number(depositBalance) + Number(bonusBalance) > 0;

  return (
    <>
      <div className="flex items-stretch h-9 rounded-full bg-[var(--v-bg-3)] border border-[color:var(--v-line-2)] overflow-hidden min-w-0">
        <button
          onClick={() => { setOpen(true); refresh(); }}
          aria-label={`Wallet: ${shown} ETB`}
          className="flex items-center gap-1.5 pl-3 pr-2.5 min-w-0 hover:bg-[var(--v-bg-4)] transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--v-teal)] shrink-0" aria-hidden />
          {/* keyed on the amount so a change replays the bump */}
          <span key={shown} className="v-bump text-[13px] font-bold text-white tabular-nums truncate">{shown}</span>
          <span className="text-[10px] font-semibold text-[color:var(--v-text-3)] shrink-0">ETB</span>
        </button>
        <Link
          href="/deposit"
          aria-label="Deposit"
          className="grid place-items-center w-9 bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] hover:bg-[#FF8F26] transition-colors"
        >
          <Plus className="w-4 h-4" strokeWidth={2.6} />
        </Link>
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Wallet">
        <div className="rounded-[18px] bg-[var(--v-bg-3)] border border-[color:var(--v-line)] p-4">
          <div className="flex items-center justify-between">
            <p className="v-eyebrow">Available balance</p>
            <button
              onClick={refresh}
              aria-label="Refresh balance"
              className="w-8 h-8 grid place-items-center rounded-full text-[color:var(--v-text-3)] hover:text-white hover:bg-[var(--v-bg-4)] transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[32px] font-extrabold text-white tabular-nums leading-none">
            <span key={shown} className="v-bump inline-block">{shown}</span>
            <span className="ml-1.5 text-[14px] font-bold text-[color:var(--v-text-3)]">ETB</span>
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Pot label="Withdrawable" value={fmt(withdrawable)} tone="var(--v-green)" />
            <Pot label="Deposit" value={fmt(depositBalance)} hint={playOnly ? "Play only" : undefined} />
            <Pot label="Bonus" value={fmt(bonusBalance)} tone="var(--v-amber)" hint={playOnly ? "Play only" : undefined} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-3">
          <Link href="/deposit" onClick={() => setOpen(false)} className="v-btn v-btn-primary h-12">
            <ArrowDownLeft className="w-4 h-4" /> Deposit
          </Link>
          <Link href="/withdraw" onClick={() => setOpen(false)} className="v-btn v-btn-ghost h-12">
            <ArrowUpRight className="w-4 h-4" /> Withdraw
          </Link>
        </div>

        <div className="mt-3 rounded-[16px] border border-[color:var(--v-line)] divide-y divide-[color:var(--v-line)] overflow-hidden">
          <SheetRow href="/account#transactions" icon={<History className="w-4 h-4" />} label="Transaction history" onClick={() => setOpen(false)} />
          <SheetRow href="/withdrawals" icon={<Clock className="w-4 h-4" />} label="Withdrawal requests" onClick={() => setOpen(false)} />
          <SheetRow
            href="/rewards/streak"
            icon={<StreakFlame days={streakDays ?? 0} active={(streakDays ?? 0) > 0} className="w-4 h-4" />}
            label="Daily streak"
            value={`${streakDays ?? 0} day${streakDays === 1 ? "" : "s"}`}
            onClick={() => setOpen(false)}
          />
        </div>
      </BottomSheet>
    </>
  );
}

function Pot({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-[12px] bg-[var(--v-bg-2)] px-2.5 py-2 min-w-0">
      <p className="text-[10px] font-semibold text-[color:var(--v-text-3)] truncate">{label}</p>
      <p className="text-[13px] font-bold tabular-nums truncate mt-0.5" style={{ color: tone ?? "#fff" }}>{value}</p>
      {hint && <p className="text-[9px] text-[color:var(--v-text-3)] mt-0.5">{hint}</p>}
    </div>
  );
}

function SheetRow({
  href, icon, label, value, onClick,
}: { href: string; icon: React.ReactNode; label: string; value?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-3 px-4 h-12 hover:bg-[var(--v-bg-3)] transition-colors">
      <span className="text-[color:var(--v-text-2)]">{icon}</span>
      <span className="text-[14px] font-medium text-white flex-1">{label}</span>
      {value && <span className="text-[12px] font-semibold text-[color:var(--v-text-3)] tabular-nums">{value}</span>}
      <ArrowUpRight className="w-4 h-4 text-[color:var(--v-text-3)]" />
    </Link>
  );
}
