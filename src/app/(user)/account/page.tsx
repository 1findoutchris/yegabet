"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  ChevronLeft, Wallet, Plus, ArrowUpRight, Gift, Crown, Phone, Mail, IdCard,
  ShieldCheck, LogOut, ArrowDownLeft, Dice5, Trophy, Receipt, Loader2, Clock, Settings,
} from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useBalance } from "@/contexts/BalanceContext";
import { ReferralCard } from "@/components/account/ReferralCard";
import { PushToggle } from "@/components/account/PushToggle";

interface Txn {
  id: string; type: string; status: string; amount: number; createdAt: string; method: string | null;
}
interface PendingDeposit {
  id: string; amount: number; method: string; createdAt: string;
}
interface Account {
  accountNo: number;
  username: string; name: string | null; phone: string; email: string | null;
  balance: number; depositBalance: number; bonusBalance: number; withdrawable: number;
  loyaltyTier: string; loyaltyPoints: number; pointsBalance: number; isVerified: boolean; memberSince: string;
  referralCode: string;
  transactions: Txn[];
  pendingDeposits: PendingDeposit[];
}

const TIER_COLOR: Record<string, string> = {
  BRONZE: "#CD7F32", SILVER: "#C7CCD1", GOLD: "#F0A500", PLATINUM: "#9FE7E3", DIAMOND: "#7DE8D8", VIP: "#D8B4FF",
};

const TXN_META: Record<string, { icon: typeof Wallet; color: string; sign: string }> = {
  DEPOSIT:    { icon: ArrowDownLeft, color: "#2BD974", sign: "+" },
  WITHDRAWAL: { icon: ArrowUpRight,  color: "#FF3B5C", sign: "−" },
  BET:        { icon: Dice5,         color: "#A79FB5", sign: "−" },
  WIN:        { icon: Trophy,        color: "#2BD974", sign: "+" },
  BONUS:      { icon: Gift,          color: "#2DD4BF", sign: "+" },
  COMMISSION: { icon: Receipt,       color: "#C07AFF", sign: "+" },
  REFUND:     { icon: Receipt,       color: "#2BD974", sign: "+" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AccountPage() {
  const { data: session, status } = useSession();
  const { openLogin } = useAuthModal();
  const { balance: liveBalance } = useBalance();
  const [data, setData] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAccount = useCallback(() => {
    return fetch("/api/user/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { setLoading(false); return; }
    loadAccount().finally(() => setLoading(false));
  }, [session, status, loadAccount]);

  // Re-sync (no spinner) whenever the live wallet balance changes — e.g. a
  // deposit approval moves a pending request into completed history.
  useEffect(() => {
    if (!session) return;
    loadAccount();
  }, [liveBalance, session, loadAccount]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] grid place-items-center mx-auto mb-4">
          <Wallet className="w-6 h-6 text-[color:var(--gold)]" />
        </div>
        <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Your account</h1>
        <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 mb-5">Log in to view your balance, rank and history.</p>
        <button onClick={openLogin} className="px-6 py-3 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm glow-gold hover:scale-[1.02] transition-transform">
          Log in
        </button>
      </div>
    );
  }

  const tierColor = data ? (TIER_COLOR[data.loyaltyTier] ?? "#2DD4BF") : "#2DD4BF";
  const displayName = data?.name?.trim() || data?.username || "Player";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-24 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/casino" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">My Account</h1>
        {/* The nav dropdown that also links here is desktop-only, so on mobile
            this gear is the only way into settings. */}
        <Link
          href="/account/settings"
          aria-label="Settings"
          className="ml-auto p-2 rounded-xl border border-[color:var(--border-base)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--border-accent)] transition-colors"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {/* Profile + balance card */}
      <div className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-5 sm:p-6"
        style={{ background: "linear-gradient(150deg,#1A4252,#12303C 60%)" }}>
        <span aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full" style={{ background: "radial-gradient(circle,rgba(45,212,191,0.16),transparent 65%)" }} />

        <div className="relative z-10 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full grid place-items-center font-display font-extrabold text-[#1B1430] text-xl bg-gold-grad shrink-0"
            style={{ boxShadow: "0 0 18px rgba(45,212,191,0.4)" }}>
            {initial}
          </div>
          <div className="min-w-0">
            <p className="font-display text-[18px] font-bold text-[color:var(--text-primary)] truncate">{displayName}</p>
            <span className="inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em]"
              style={{ color: tierColor, background: `${tierColor}1A`, border: `1px solid ${tierColor}55` }}>
              <Crown className="w-3 h-3" /> {data?.loyaltyTier}
            </span>
          </div>
          {data?.isVerified && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[color:var(--green)]">
              <ShieldCheck className="w-3.5 h-3.5" /> Verified
            </span>
          )}
        </div>

        {/* Balances */}
        <div className="relative z-10 grid grid-cols-2 gap-3 mt-5">
          <div className="rounded-2xl bg-[var(--bg-surface)]/70 border border-[color:var(--border-base)] p-4">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Total balance</p>
            <p className="font-display text-[24px] font-extrabold text-gold-grad tabular-nums leading-none mt-1">
              {Number(data?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">ETB · ready to play</p>
          </div>
          <div className="rounded-2xl bg-[var(--bg-surface)]/70 border border-[color:var(--border-base)] p-4">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Withdrawable</p>
            <p className="font-display text-[24px] font-extrabold text-[color:var(--green)] tabular-nums leading-none mt-1">
              {Number(data?.withdrawable ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">ETB · your winnings</p>
          </div>
        </div>

        {/* What makes up the balance — only shown while some of it is play-only. */}
        {data && data.depositBalance + data.bonusBalance > 0 && (
          <div className="relative z-10 grid grid-cols-2 gap-3 mt-3">
            <div className="rounded-2xl bg-[var(--bg-surface)]/70 border border-[color:var(--border-base)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Deposit funds</p>
              <p className="font-display text-[16px] font-extrabold text-[color:var(--text-primary)] tabular-nums leading-none mt-1">
                {Number(data.depositBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">Play only</p>
            </div>
            <div className="rounded-2xl bg-[var(--bg-surface)]/70 border border-[color:var(--border-base)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Bonus funds</p>
              <p className="font-display text-[16px] font-extrabold text-[color:var(--purple-2)] tabular-nums leading-none mt-1">
                {Number(data.bonusBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">Play only</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="relative z-10 grid grid-cols-2 gap-3 mt-3">
          <Link href="/deposit" className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-gold-grad text-[#09090B] font-bold text-[14px] glow-gold hover:scale-[1.01] transition-transform">
            <Plus className="w-4 h-4" /> Deposit
          </Link>
          <Link href="/withdraw" className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-bold text-[14px] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-colors">
            <ArrowUpRight className="w-4 h-4" /> Withdraw
          </Link>
        </div>

        {/* Track / cancel pending withdrawals */}
        <Link href="/withdrawals" className="relative z-10 flex items-center gap-2 mt-3 text-[12px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors">
          <Clock className="w-3.5 h-3.5 text-[color:var(--text-muted)]" />
          View withdrawal requests
          <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-[color:var(--text-muted)]" />
        </Link>
      </div>

      {/* Loyalty + details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: `${tierColor}1A`, border: `1px solid ${tierColor}55` }}>
            <Crown className="w-5 h-5" style={{ color: tierColor }} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Loyalty points</p>
            <p className="font-display text-[18px] font-extrabold text-[color:var(--text-primary)] tabular-nums">{data?.loyaltyPoints.toLocaleString()}</p>
            {/* Lifetime total sets the tier; the wallet below is what can be spent. */}
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 tabular-nums">
              {(data?.pointsBalance ?? 0).toLocaleString()} to spend
            </p>
          </div>
          <Link href="/rewards/bonuses" className="ml-auto text-[12px] text-[color:var(--gold)] font-medium">Redeem →</Link>
        </div>
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
          {/* The number support asks for — tabular so it reads back cleanly. */}
          <div className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
            <IdCard className="w-4 h-4 text-[color:var(--text-muted)]" />
            <span className="tabular-nums tracking-[0.06em] font-semibold text-[color:var(--text-primary)]">
              {data?.accountNo}
            </span>
            <span className="text-[11px] text-[color:var(--text-muted)]">account ID</span>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)] mt-2">
            <Phone className="w-4 h-4 text-[color:var(--text-muted)]" /> {data?.phone}
          </div>
          {data?.email && (
            <div className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)] mt-2">
              <Mail className="w-4 h-4 text-[color:var(--text-muted)]" /> {data.email}
            </div>
          )}
          <p className="text-[11px] text-[color:var(--text-muted)] mt-2">Member since {data ? fmtDate(data.memberSince) : ""}</p>
        </div>
      </div>

      {/* Push notifications opt-in */}
      <PushToggle />

      {/* Refer & earn */}
      {data && <ReferralCard code={data.referralCode} />}

      {/* Pending deposits — awaiting agent SMS confirmation */}
      {data && data.pendingDeposits.length > 0 && (
        <div>
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)] mb-3">Deposit requests</h2>
          <div className="rounded-2xl border border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)] divide-y divide-[color:var(--border-muted)] overflow-hidden">
            {data.pendingDeposits.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-[#2DD4BF1A]">
                  <Clock className="w-4 h-4 text-[color:var(--gold)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)] capitalize">
                    Deposit · {d.method}
                  </p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{fmtDate(d.createdAt)} · awaiting confirmation</p>
                </div>
                <div className="ml-auto flex flex-col items-end shrink-0">
                  <p className="font-bold text-[14px] tabular-nums text-[color:var(--gold)]">
                    {Number(d.amount).toLocaleString()} <span className="text-[11px] text-[color:var(--text-muted)] font-medium">ETB</span>
                  </p>
                  <span className="inline-flex items-center gap-1 mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[color:var(--gold)] bg-[#2DD4BF18] border border-[color:var(--border-accent)]">
                    Pending
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions */}
      <div>
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)] mb-3">Recent transactions</h2>
        {data && data.transactions.length > 0 ? (
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] divide-y divide-[color:var(--border-muted)] overflow-hidden">
            {data.transactions.map((t) => {
              const meta = TXN_META[t.type] ?? TXN_META.BET;
              const Icon = meta.icon;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${meta.color}1A` }}>
                    <Icon className="w-4 h-4" style={{ color: meta.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)] capitalize">
                      {t.type.toLowerCase()}{t.method ? ` · ${t.method}` : ""}
                    </p>
                    <p className="text-[11px] text-[color:var(--text-muted)]">{fmtDate(t.createdAt)} · {t.status.toLowerCase()}</p>
                  </div>
                  <p className="ml-auto font-bold text-[14px] tabular-nums shrink-0" style={{ color: meta.color }}>
                    {meta.sign}{Number(t.amount).toLocaleString()} <span className="text-[11px] text-[color:var(--text-muted)] font-medium">ETB</span>
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] py-10 text-center">
            <p className="text-[13px] text-[color:var(--text-muted)]">No transactions yet</p>
            <Link href="/deposit" className="inline-block mt-3 text-[13px] font-semibold text-[color:var(--gold)]">Make your first deposit →</Link>
          </div>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="flex items-center justify-center gap-2 h-12 rounded-2xl border border-[color:var(--border-base)] text-[color:var(--red)] font-semibold text-[14px] hover:bg-[var(--bg-elevated)] transition-colors"
      >
        <LogOut className="w-4 h-4" /> Log out
      </button>
    </div>
  );
}
