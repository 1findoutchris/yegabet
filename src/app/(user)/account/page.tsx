"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  Wallet, ArrowUpRight, Gift, Crown, Phone, Mail, ShieldCheck, LogOut, ArrowDownLeft,
  Dice5, Trophy, Receipt, Clock, Settings, ChevronRight, Ticket, Gamepad2, History,
  Sparkles, Star, Headphones, SearchCheck, Lock,
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
  BRONZE: "#CD7F32", SILVER: "#C7CCD1", GOLD: "#F0A500", PLATINUM: "#9FE7E3", DIAMOND: "#FFA040", VIP: "#FAD27E",
};

const TXN_META: Record<string, { icon: typeof Wallet; color: string; sign: string }> = {
  DEPOSIT:    { icon: ArrowDownLeft, color: "#34D399", sign: "+" },
  WITHDRAWAL: { icon: ArrowUpRight,  color: "#F43F5E", sign: "−" },
  BET:        { icon: Dice5,         color: "#8C8C8C", sign: "−" },
  WIN:        { icon: Trophy,        color: "#34D399", sign: "+" },
  BONUS:      { icon: Gift,          color: "#FF7A00", sign: "+" },
  COMMISSION: { icon: Receipt,       color: "#F5B83D", sign: "+" },
  REFUND:     { icon: Receipt,       color: "#34D399", sign: "+" },
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
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 flex flex-col gap-4" aria-busy>
        <div className="flex items-center gap-4"><div className="v-skel w-14 h-14 rounded-full" /><div className="flex-1 space-y-2"><div className="v-skel h-4 w-40" /><div className="v-skel h-3 w-24" /></div></div>
        <div className="v-skel h-48 rounded-[22px]" />
        <div className="v-skel h-64 rounded-[18px]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-full bg-[var(--v-bg-3)] grid place-items-center mx-auto mb-4">
          <Wallet className="w-6 h-6 text-[color:var(--v-teal)]" />
        </div>
        <h1 className="text-[24px] font-extrabold text-white">Your account</h1>
        <p className="text-[14px] text-[color:var(--v-text-2)] mt-1 mb-6">Log in to see your wallet, level and history.</p>
        <button onClick={openLogin} className="v-btn v-btn-primary rounded-full px-8">Log in</button>
      </div>
    );
  }

  const tierColor = data ? (TIER_COLOR[data.loyaltyTier] ?? "#FF7A00") : "#FF7A00";
  const displayName = data?.name?.trim() || data?.username || "Player";
  const initial = displayName.charAt(0).toUpperCase();
  const money = (n: number | undefined) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16 flex flex-col gap-6">
      {/* Profile */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full grid place-items-center text-[20px] font-extrabold text-white bg-[var(--v-bg-4)] border border-[color:var(--v-line-2)] shrink-0">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-white truncate">{displayName}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: tierColor, background: `${tierColor}1A` }}>
              <Crown className="w-3 h-3" /> {data?.loyaltyTier}
            </span>
            <span className="text-[12px] text-[color:var(--v-text-3)] tabular-nums">ID {data?.accountNo}</span>
            {data?.isVerified && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--v-green)]">
                <ShieldCheck className="w-3.5 h-3.5" /> Verified
              </span>
            )}
          </div>
        </div>
        {/* The header avatar menu also links here; on phones this is the quick way in. */}
        <Link href="/account/settings" aria-label="Settings" className="w-10 h-10 grid place-items-center rounded-full bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] hover:text-white transition-colors">
          <Settings className="w-[18px] h-[18px]" />
        </Link>
      </div>

      {/* Wallet */}
      <section className="rounded-[22px] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] p-5">
        <p className="v-eyebrow">Total balance</p>
        <p className="mt-1.5 text-[34px] font-extrabold text-white tabular-nums leading-none">
          {money(data?.balance)} <span className="text-[14px] font-bold text-[color:var(--v-text-3)]">ETB</span>
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Pot label="Withdrawable" value={money(data?.withdrawable)} tone="var(--v-green)" />
          <Pot label="Deposit funds" value={money(data?.depositBalance)} hint="Play only" />
          <Pot label="Bonus funds" value={money(data?.bonusBalance)} tone="var(--v-amber)" hint="Play only" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-4">
          <Link href="/deposit" className="v-btn v-btn-primary h-12"><ArrowDownLeft className="w-4 h-4" /> Deposit</Link>
          <Link href="/withdraw" className="v-btn v-btn-ghost h-12"><ArrowUpRight className="w-4 h-4" /> Withdraw</Link>
        </div>
      </section>

      {/* Pending deposits — awaiting agent SMS confirmation */}
      {data && data.pendingDeposits.length > 0 && (
        <MenuGroup title="Deposit requests">
          {data.pendingDeposits.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-9 h-9 rounded-[12px] grid place-items-center shrink-0 bg-[var(--v-teal-a12)]">
                <Clock className="w-4 h-4 text-[color:var(--v-teal)]" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-white capitalize">Deposit · {d.method}</p>
                <p className="text-[12px] text-[color:var(--v-text-3)]">{fmtDate(d.createdAt)} · awaiting confirmation</p>
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className="font-bold text-[14px] tabular-nums text-white">{Number(d.amount).toLocaleString()} <span className="text-[11px] text-[color:var(--v-text-3)]">ETB</span></p>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--v-teal)]">Pending</span>
              </div>
            </div>
          ))}
        </MenuGroup>
      )}

      <MenuGroup title="Wallet">
        <MenuRow href="/deposit" icon={ArrowDownLeft} label="Deposit" />
        <MenuRow href="/withdraw" icon={ArrowUpRight} label="Withdraw" hint={`${money(data?.withdrawable)} ETB available`} />
        <MenuRow href="/withdrawals" icon={Clock} label="Withdrawal requests" />
        <MenuRow href="#transactions" icon={History} label="Transactions" />
      </MenuGroup>

      <MenuGroup title="Betting">
        <MenuRow href="/tickets" icon={Ticket} label="Bet history" />
        <MenuRow href="/my-casino" icon={Gamepad2} label="Casino history" hint="Recent games and big wins" />
        <MenuRow href="/check" icon={SearchCheck} label="Check a ticket" />
      </MenuGroup>

      <MenuGroup title="Rewards">
        <MenuRow href="/rewards" icon={Sparkles} label="Rewards" hint={`${(data?.loyaltyPoints ?? 0).toLocaleString()} XP`} />
        <MenuRow href="/rewards/bonuses" icon={Gift} label="Bonuses" hint={`${(data?.pointsBalance ?? 0).toLocaleString()} points to spend`} />
        <MenuRow href="/rewards/vip" icon={Star} label="VIP" />
      </MenuGroup>

      <MenuGroup title="Profile & security">
        <div className="px-4 py-3 flex flex-col gap-2 text-[13px] text-[color:var(--v-text-2)]">
          <span className="flex items-center gap-2.5"><Phone className="w-4 h-4 text-[color:var(--v-text-3)]" /> {data?.phone}</span>
          {data?.email && <span className="flex items-center gap-2.5"><Mail className="w-4 h-4 text-[color:var(--v-text-3)]" /> {data.email}</span>}
          <span className="text-[12px] text-[color:var(--v-text-3)]">Member since {data ? fmtDate(data.memberSince) : ""}</span>
        </div>
        <MenuRow href="/account/settings" icon={Lock} label="Password & settings" />
      </MenuGroup>

      {/* Push notifications opt-in */}
      <PushToggle />

      {/* Refer & earn */}
      {data && <ReferralCard code={data.referralCode} />}

      {/* Transactions */}
      <section id="transactions" className="scroll-mt-20">
        <h2 className="v-eyebrow mb-3 px-1">Recent transactions</h2>
        {data && data.transactions.length > 0 ? (
          <div className="rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)] divide-y divide-[color:var(--v-line)] overflow-hidden">
            {data.transactions.map((t) => {
              const meta = TXN_META[t.type] ?? TXN_META.BET;
              const Icon = meta.icon;
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 rounded-[12px] grid place-items-center shrink-0" style={{ background: `${meta.color}1A` }}>
                    <Icon className="w-4 h-4" style={{ color: meta.color }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-white capitalize truncate">
                      {t.type.toLowerCase()}{t.method ? ` · ${t.method}` : ""}
                    </p>
                    <p className="text-[12px] text-[color:var(--v-text-3)]">{fmtDate(t.createdAt)} · {t.status.toLowerCase()}</p>
                  </div>
                  <p className="ml-auto font-bold text-[14px] tabular-nums shrink-0" style={{ color: meta.sign === "+" ? meta.color : "#fff" }}>
                    {meta.sign}{Number(t.amount).toLocaleString()} <span className="text-[11px] text-[color:var(--v-text-3)] font-medium">ETB</span>
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)] py-10 text-center">
            <p className="text-[14px] text-[color:var(--v-text-3)]">No transactions yet</p>
            <Link href="/deposit" className="inline-block mt-3 text-[13px] font-bold text-[color:var(--v-teal)]">Make your first deposit</Link>
          </div>
        )}
      </section>

      <MenuGroup title="Support">
        <MenuRow href="https://t.me/vinnabet" icon={Headphones} label="Help & support" hint="Telegram" external />
      </MenuGroup>

      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="v-btn h-12 rounded-[16px] border border-[color:var(--v-line-2)] text-[color:var(--v-red)] hover:bg-[var(--v-bg-2)]"
      >
        <LogOut className="w-4 h-4" /> Log out
      </button>
    </div>
  );
}

function Pot({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-[12px] bg-[var(--v-bg-3)] px-2.5 py-2 min-w-0">
      <p className="text-[10px] font-semibold text-[color:var(--v-text-3)] truncate">{label}</p>
      <p className="text-[13px] font-bold tabular-nums truncate mt-0.5" style={{ color: tone ?? "#fff" }}>{value}</p>
      {hint && <p className="text-[9px] text-[color:var(--v-text-3)] mt-0.5">{hint}</p>}
    </div>
  );
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="v-eyebrow mb-2.5 px-1">{title}</h2>
      <div className="rounded-[18px] border border-[color:var(--v-line)] bg-[var(--v-bg-2)] divide-y divide-[color:var(--v-line)] overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function MenuRow({
  href, icon: Icon, label, hint, external,
}: { href: string; icon: typeof Wallet; label: string; hint?: string; external?: boolean }) {
  const cls = "group flex items-center gap-3 px-4 h-14 hover:bg-[var(--v-bg-3)] transition-colors";
  const inner = (
    <>
      <span className="w-9 h-9 rounded-[12px] grid place-items-center bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] group-hover:text-[color:var(--v-teal)] transition-colors shrink-0">
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold text-white truncate">{label}</span>
        {hint && <span className="block text-[12px] text-[color:var(--v-text-3)] truncate">{hint}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-[color:var(--v-text-3)] transition-transform group-hover:translate-x-0.5" />
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
  ) : (
    <Link href={href} className={cls}>{inner}</Link>
  );
}
