"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAdminFetch } from "../../useAdmin";
import { toast } from "sonner";
import {
  Loader2, ChevronLeft, ShieldOff, ShieldCheck, Lock, Wallet,
  TrendingUp, TrendingDown, Dice5, Gift, Receipt, Ticket, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Which pot an adjustment moves. Must match the bucket enum in
 *  /api/admin/users/[id]. */
type Bucket = "withdrawable" | "deposit" | "bonus";

const BUCKETS: { id: Bucket; label: string; hint: string }[] = [
  { id: "withdrawable", label: "Withdrawable", hint: "Plain cash — no wagering or turnover strings attached." },
  { id: "deposit",      label: "Deposit",      hint: "Cash carrying the AML turnover lock, like a real deposit — must be wagered once before it can be withdrawn." },
  { id: "bonus",        label: "Bonus",        hint: "Locked bonus credit — releases to cash only after the wagering requirement is cleared." },
];

interface UserDetail {
  id: string; accountNo: number;
  username: string; name: string | null; phone: string; email: string | null;
  balance: number; depositBalance: number; bonusBalance: number; withdrawable: number;
  loyaltyPoints: number; loyaltyTier: string; isActive: boolean; isVerified: boolean;
  role: string; streakDays: number; spinCredits: number; createdAt: string; lastSeenAt: string | null;
  telegramUserId: string | null; telegramUsername: string | null; telegramLinkedAt: string | null;
  totalDeposited: number; totalWithdrawn: number;
  _count: { bets: number; depositRequests: number; withdrawalRequests: number };
  transactions: {
    id: string; type: string; status: string; amount: number;
    balanceBefore: number; balanceAfter: number; reference: string; createdAt: string;
  }[];
  deposits: {
    id: string; amount: number; method: string; status: string;
    smsRef: string | null; receiptText: string; adminNote: string | null;
    createdAt: string; updatedAt: string;
  }[];
  withdrawals: {
    id: string; publicId: string | null; amount: number; method: string;
    account: string; accountName: string; status: string; adminNote: string | null;
    createdAt: string; updatedAt: string; paidAt: string | null; hasProof: boolean;
  }[];
}

const REQ_COLOR: Record<string, string> = {
  PENDING: "#F59E0B", APPROVED: "#2BD974", COMPLETED: "#2BD974",
  REJECTED: "#FF3B5C", CANCELLED: "#A79FB5", PROCESSING: "#C07AFF",
};

const TXN_COLOR: Record<string, string> = { DEPOSIT: "#2BD974", WITHDRAWAL: "#FF3B5C", BET: "#A79FB5", WIN: "#2BD974", BONUS: "#2DD4BF", COMMISSION: "#C07AFF", REFUND: "#2BD974" };
const TXN_SIGN: Record<string, string> = { DEPOSIT: "+", WITHDRAWAL: "−", BET: "−", WIN: "+", BONUS: "+", COMMISSION: "+", REFUND: "+" };
const TIER_COLOR: Record<string, string> = { BRONZE: "#CD7F32", SILVER: "#C7CCD1", GOLD: "#F0A500", PLATINUM: "#9FE7E3", VIP: "#D8B4FF" };

function fmtETB(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 2 }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

export default function UserDetailPage() {
  const { secret, userId } = useParams<{ secret: string; userId: string }>();
  const router = useRouter();
  const adminFetch = useAdminFetch();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // Adjust balance form
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [spinAmount, setSpinAmount] = useState("");
  const [spinNote, setSpinNote] = useState("");
  const [adjBucket, setAdjBucket] = useState<Bucket>("withdrawable");

  function load() {
    setLoading(true);
    adminFetch(`/users/${userId}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setUser)
      .catch(() => toast.error("Failed to load user"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function postAction(action: string, extra?: object) {
    setActing(true);
    try {
      const res = await adminFetch(`/users/${userId}`, {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Action failed"); return; }
      toast.success("Done");
      load();
    } catch { toast.error("Network error"); }
    finally { setActing(false); }
  }

  // Direction comes from which button was pressed, not from the sign the admin
  // typed — a stray minus in an amount field is an easy way to move money the
  // wrong way. The API still takes a signed amount.
  async function adjustBalance(direction: 1 | -1) {
    const amt = Math.abs(parseFloat(adjAmount));
    if (isNaN(amt) || amt === 0) { toast.error("Enter an amount"); return; }
    await postAction("adjust", { amount: amt * direction, bucket: adjBucket, note: adjNote || undefined });
    setAdjAmount(""); setAdjNote("");
  }

  async function grantSpins(direction: 1 | -1) {
    const n = Math.abs(parseInt(spinAmount, 10));
    if (isNaN(n) || n === 0) { toast.error("Enter a number of spins"); return; }
    await postAction("grant-spins", { amount: n * direction, note: spinNote || undefined });
    setSpinAmount(""); setSpinNote("");
  }

  async function deleteUser() {
    if (!user) return;
    // Typed confirmation, not just OK/Cancel: this one can't be undone, and the
    // page it lives on looks like every other admin page.
    const typed = prompt(
      `Permanently delete @${user.username} and all their history?\n\nType the username to confirm:`
    );
    if (typed?.trim() !== user.username) {
      if (typed !== null) toast.error("Username didn't match — nothing deleted");
      return;
    }
    setActing(true);
    try {
      const res = await adminFetch(`/users/${userId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Delete failed"); return; }
      toast.success(`@${user.username} deleted`);
      router.push(`/admin/${secret}/users`);
    } catch { toast.error("Network error"); }
    finally { setActing(false); }
  }

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  if (!user) return <div className="p-8 text-[color:var(--red)] text-sm">User not found.</div>;

  const tierColor = TIER_COLOR[user.loyaltyTier] ?? "#2DD4BF";

  return (
    <div className="p-5 sm:p-7 max-w-4xl space-y-6">
      {/* Back */}
      <Link href={`/admin/${secret}/users`} className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to users
      </Link>

      {/* Profile card */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[20px] font-extrabold text-[color:var(--text-primary)]">{user.name || user.username}</h1>
              {!user.isActive && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold text-[color:var(--red)] bg-[#FF3B5C20] border border-[#FF3B5C44]">BANNED</span>}
              {user.isVerified && <span className="px-2 py-0.5 rounded-md text-[11px] font-bold text-[color:var(--green)] bg-[#2BD97420] border border-[#2BD97444]">VERIFIED</span>}
            </div>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-0.5"><span className="tabular-nums font-semibold text-[color:var(--text-secondary)]">{user.accountNo}</span> · @{user.username} · {user.phone}{user.email ? ` · ${user.email}` : ""}</p>
            <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">Joined {fmtDate(user.createdAt)} · {user.role}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold"
            style={{ color: tierColor, background: `${tierColor}1A`, border: `1px solid ${tierColor}55` }}>
            {user.loyaltyTier} · {user.loyaltyPoints.toLocaleString()} pts
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
          {[
            { label: "Balance",       value: `ETB ${fmtETB(user.balance)}`,        color: "var(--gold)" },
            { label: "Withdrawable",  value: `ETB ${fmtETB(user.withdrawable)}`,   color: "var(--green)" },
            { label: "Deposit",       value: `ETB ${fmtETB(user.depositBalance)}`, color: "#F59E0B" },
            { label: "Bonus",         value: `ETB ${fmtETB(user.bonusBalance)}`,   color: "var(--purple-2)" },
            { label: "Streak",    value: `${user.streakDays} days`,               color: "var(--text-secondary)" },
            { label: "Spins",     value: `${user.spinCredits}`,                   color: "var(--purple-2)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] p-3">
              <p className="text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
              <p className="font-display text-[16px] font-extrabold tabular-nums mt-0.5" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Lifetime cash in and out, over approved requests only — the counts
            beside them include pending and rejected ones, which moved nothing. */}
        <div className="grid grid-cols-3 gap-3 mt-3 text-center">
          {[
            {
              label: `${user._count.depositRequests} deposit${user._count.depositRequests === 1 ? "" : "s"}`,
              value: `ETB ${fmtETB(user.totalDeposited)}`,
              hint: "Total deposited",
              color: "var(--green)",
            },
            {
              label: `${user._count.withdrawalRequests} withdrawal${user._count.withdrawalRequests === 1 ? "" : "s"}`,
              value: `ETB ${fmtETB(user.totalWithdrawn)}`,
              hint: "Total withdrawn",
              color: "var(--red)",
            },
            {
              label: "",
              value: user._count.bets.toLocaleString(),
              hint: "Bets",
              color: "var(--text-primary)",
            },
          ].map(({ label, value, hint, color }) => (
            <div key={hint} className="rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] py-3 px-2">
              <p className="font-display text-[16px] font-extrabold tabular-nums" style={{ color }}>{value}</p>
              <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{hint}</p>
              {label && <p className="text-[10px] text-[color:var(--text-muted)] opacity-70">{label}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Balance adjustment */}
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[color:var(--gold)]" />
            <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Adjust balance</h2>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {BUCKETS.map((b) => (
              <button
                key={b.id}
                onClick={() => setAdjBucket(b.id)}
                className={cn(
                  "h-9 rounded-xl text-[12px] font-semibold border transition-colors",
                  adjBucket === b.id
                    ? "bg-[var(--bg-accent-dim)] border-[color:var(--border-accent)] text-[color:var(--text-primary)]"
                    : "bg-[var(--bg-elevated)] border-[color:var(--border-base)] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]"
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            {BUCKETS.find((b) => b.id === adjBucket)?.hint}
          </p>

          <input value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="Amount (e.g. 500)" type="number" min="0"
            className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Reason (required for audit)"
            className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => adjustBalance(1)} disabled={acting}
              className="h-10 rounded-xl bg-[#2BD97420] border border-[#2BD97444] text-[color:var(--green)] font-bold text-[13px] hover:bg-[#2BD97435] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />} Add
            </button>
            <button onClick={() => adjustBalance(-1)} disabled={acting}
              className="h-10 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] font-bold text-[13px] hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />} Deduct
            </button>
          </div>
        </div>

        {/* Prize-wheel coupons */}
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Prize wheel spins</h2>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              holds <b className="text-[color:var(--purple-2)]">{user.spinCredits}</b>
            </span>
          </div>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Coupons for the prize wheel. Normally earned by referring a verified signup —
            grant them here for support fixes or promotions.
          </p>

          <div className="flex gap-2">
            {[1, 3, 5].map((n) => (
              <button
                key={n}
                onClick={() => setSpinAmount(String(n))}
                className="flex-1 h-9 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[12px] font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
              >
                {n}
              </button>
            ))}
          </div>

          <input value={spinAmount} onChange={(e) => setSpinAmount(e.target.value)} placeholder="Spins (e.g. 3)" type="number" step="1" min="0"
            className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          <input value={spinNote} onChange={(e) => setSpinNote(e.target.value)} placeholder="Reason (required for audit)"
            className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => grantSpins(1)} disabled={acting}
              className="h-10 rounded-xl bg-[#2BD97420] border border-[#2BD97444] text-[color:var(--green)] font-bold text-[13px] hover:bg-[#2BD97435] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />} Add
            </button>
            <button onClick={() => grantSpins(-1)} disabled={acting}
              className="h-10 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] font-bold text-[13px] hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />} Deduct
            </button>
          </div>
        </div>

        {/* Account actions */}
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Account actions</h2>

          {user.isActive ? (
            <button onClick={() => postAction("ban")} disabled={acting}
              className="w-full h-10 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] font-bold text-[13px] hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              <ShieldOff className="w-4 h-4" /> Ban user
            </button>
          ) : (
            <button onClick={() => postAction("unban")} disabled={acting}
              className="w-full h-10 rounded-xl bg-[#2BD97420] border border-[#2BD97444] text-[color:var(--green)] font-bold text-[13px] hover:bg-[#2BD97435] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Unban user
            </button>
          )}

          {user.telegramUserId && (
            <div className="rounded-xl border border-[color:var(--border-base)] p-3 text-[12px] text-[color:var(--text-secondary)] space-y-2">
              <p>
                Telegram linked{user.telegramUsername ? ` · @${user.telegramUsername}` : ""} · id {user.telegramUserId}
                {user.telegramLinkedAt ? ` · since ${fmtDate(user.telegramLinkedAt)}` : ""}
              </p>
              <button onClick={() => postAction("unlink-telegram")} disabled={acting}
                className="w-full h-9 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] font-bold text-[12px] text-[color:var(--text-primary)] disabled:opacity-40">
                Unlink Telegram (player can then link another Telegram account)
              </button>
            </div>
          )}

          {user.depositBalance + user.bonusBalance > 0 && (
            <button onClick={() => postAction("unlock-funds")} disabled={acting}
              className="w-full h-10 rounded-xl bg-[#F59E0B20] border border-[#F59E0B44] text-[#F59E0B] font-bold text-[13px] hover:bg-[#F59E0B35] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              <Lock className="w-4 h-4" /> Make all funds withdrawable (ETB {fmtETB(user.depositBalance + user.bonusBalance)})
            </button>
          )}

          {user.role !== "ADMIN" && user.role !== "SUPERADMIN" && (
          <div className="pt-3 border-t border-[color:var(--border-muted)]">
            <button onClick={deleteUser} disabled={acting}
              className="w-full h-10 rounded-xl bg-[#FF3B5C] text-white font-bold text-[13px] hover:bg-[#E02F4E] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete user
            </button>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-2">
              Erases the account, its bets, requests and ledger. Not reversible —
              ban instead if you might want it back. Requires a zero balance and no open payout
              (and, for an in-person agent, no ticket still in play or won but unpaid).
            </p>
          </div>
          )}
        </div>
      </div>

      {/* Deposit & withdrawal requests */}
      <div className="grid lg:grid-cols-2 gap-4">
        <RequestList
          title="Deposit requests"
          total={user._count.depositRequests}
          shown={user.deposits.length}
          empty="No deposit requests."
          rows={user.deposits.map((d) => ({
            id: d.id,
            amount: d.amount,
            status: d.status,
            createdAt: d.createdAt,
            settledAt: d.status === "PENDING" ? null : d.updatedAt,
            title: d.method,
            detail: d.smsRef ?? "no SMS ref",
            note: d.adminNote,
            message: d.receiptText,
          }))}
        />
        <RequestList
          title="Withdrawal requests"
          total={user._count.withdrawalRequests}
          shown={user.withdrawals.length}
          empty="No withdrawal requests."
          rows={user.withdrawals.map((w) => ({
            id: w.id,
            amount: w.amount,
            status: w.status,
            createdAt: w.createdAt,
            settledAt: w.paidAt ?? (w.status === "PENDING" ? null : w.updatedAt),
            title: `${w.method} · ${w.account}`,
            detail: w.publicId ?? w.accountName,
            note: w.adminNote,
            proofId: w.hasProof ? w.id : undefined,
          }))}
        />
      </div>

      {/* Transaction history */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Transaction history (last 30)</h2>
        </div>
        {user.transactions.length === 0 ? (
          <p className="text-[color:var(--text-muted)] text-sm text-center py-8">No transactions.</p>
        ) : (
          <div className="divide-y divide-[color:var(--border-muted)]">
            {user.transactions.map((t) => {
              const color = TXN_COLOR[t.type] ?? "#A79FB5";
              const sign = TXN_SIGN[t.type] ?? "+";
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-xl grid place-items-center shrink-0" style={{ background: `${color}1A` }}>
                    <span className="text-[10px] font-bold" style={{ color }}>{t.type.slice(0, 1)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)] capitalize">{t.type.toLowerCase()}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)]">{fmtDate(t.createdAt)} · {t.status} · {t.reference.slice(0, 16)}…</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-[13px] tabular-nums" style={{ color }}>{sign}ETB {fmtETB(t.amount)}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{fmtETB(t.balanceAfter)} after</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface RequestRow {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  /** When it was approved/rejected/paid — null while still PENDING. */
  settledAt: string | null;
  title: string;
  detail: string;
  note: string | null;
  /** Receipt SMS the player pasted. Deposits only — withdrawals have none. */
  message?: string;
  /** Withdrawal id to pull the payment proof from, when one is still live. */
  proofId?: string;
}

function RequestList({
  title, total, shown, empty, rows,
}: { title: string; total: number; shown: number; empty: string; rows: RequestRow[] }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--border-muted)] flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">{title}</h2>
        <span className="text-[11px] text-[color:var(--text-muted)]">
          {shown < total ? `latest ${shown} of ${total}` : `${total} total`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[color:var(--text-muted)] text-sm text-center py-8">{empty}</p>
      ) : (
        <div className="divide-y divide-[color:var(--border-muted)]">
          {rows.map((r) => {
            const color = REQ_COLOR[r.status] ?? "#A79FB5";
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)] capitalize truncate">{r.title}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)] font-mono truncate">{r.detail}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-[13px] tabular-nums text-[color:var(--text-primary)]">ETB {fmtETB(r.amount)}</p>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.04em] mt-0.5"
                      style={{ color, background: `${color}20`, border: `1px solid ${color}44` }}>
                      {r.status}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
                  {fmtDate(r.createdAt)}
                  {/* Submitted vs settled are different clocks — the gap is the
                      answer to "why did my deposit take so long". */}
                  {r.settledAt && r.settledAt !== r.createdAt && ` → ${fmtDate(r.settledAt)}`}
                </p>
                {r.note && <p className="text-[11px] text-[color:var(--text-secondary)] mt-1 break-words">{r.note}</p>}
                {/* ponytail: <details> instead of the deposits-page modal — there
                    are no actions to host here, so native disclosure gets the
                    receipt on screen with no state and keyboard support free. */}
                {r.proofId && <ProofView id={r.proofId} />}
                {r.message && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors select-none">
                      View receipt
                    </summary>
                    <div className="mt-1.5 rounded-xl bg-[var(--bg-elevated)] p-2.5 text-[11px] text-[color:var(--text-secondary)] font-mono max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                      {r.message}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Payment proof for one withdrawal, fetched only when the admin opens it.
 *
 * Not a plain <img src>: the admin API needs the x-admin-secret header, which
 * an image request cannot carry, so the bytes come through adminFetch and get
 * handed to the tag as a blob URL. Loading on first open rather than on render
 * keeps a user with twenty withdrawals from pulling twenty screenshots.
 */
function ProofView({ id }: { id: string }) {
  const adminFetch = useAdminFetch();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  // Blob URLs are held by the document until revoked, so drop it on unmount.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function open() {
    if (url || state === "loading") return;
    setState("loading");
    try {
      const res = await adminFetch(`/withdrawals/${id}/proof`);
      if (!res.ok) throw new Error(String(res.status));
      setUrl(URL.createObjectURL(await res.blob()));
      setState("idle");
    } catch {
      // Usually a 404: the proof aged past its 2 days and was swept.
      setState("error");
    }
  }

  return (
    <details className="mt-1.5" onToggle={(e) => { if (e.currentTarget.open) void open(); }}>
      <summary className="cursor-pointer text-[11px] font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors select-none">
        View payment proof
      </summary>
      <div className="mt-1.5">
        {state === "loading" && <p className="text-[11px] text-[color:var(--text-muted)]">Loading…</p>}
        {state === "error" && <p className="text-[11px] text-[color:var(--text-muted)]">Proof is no longer available.</p>}
        {url && (
          /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
          <img src={url} alt="Payment proof" className="rounded-xl border border-[color:var(--border-muted)] max-h-80 w-auto" />
        )}
      </div>
    </details>
  );
}
