"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAdminFetch } from "../useAdmin";
import { toast } from "sonner";
import { Loader2, Search, ChevronLeft, ChevronRight, ShieldOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminUserRow } from "@/app/api/admin/users/route";

// Derived from the route's row mapper, not hand-written — so removing a field
// from its `select` is a compile error here rather than the string "undefined"
// appearing in the table. `import type` is erased, so no server code reaches
// the client bundle.
type User = Omit<AdminUserRow, "createdAt"> & {
  // Dates cross the wire as strings, whatever the server-side type says.
  createdAt: string;
};

function fmtETB(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 2 }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }

const TIER_COLOR: Record<string, string> = { BRONZE: "#CD7F32", SILVER: "#C7CCD1", GOLD: "#F0A500", PLATINUM: "#9FE7E3", VIP: "#D8B4FF" };

export default function UsersPage() {
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();
  const adminFetch = useAdminFetch();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: User[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/users?q=${encodeURIComponent(search)}&page=${page}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => toast.error("Failed to load users"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(q);
    setPage(1);
  }

  return (
    <div className="p-5 sm:p-7 max-w-5xl">
      <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)] mb-5">Users</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account ID, username, phone or name…"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors" />
        </div>
        <button type="submit" className="px-4 h-10 rounded-xl bg-gold-grad text-[#09090B] text-[13px] font-bold">Search</button>
      </form>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[color:var(--gold)]" /></div>
      ) : !data || data.items.length === 0 ? (
        <p className="text-[color:var(--text-muted)] text-sm py-12 text-center">No users found.</p>
      ) : (
        <>
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[color:var(--border-muted)]">
                    {["User", "Account ID", "Balance", "Withdrawable", "Tier", "Status", "Joined", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-muted)]">
                  {data.items.map((u) => {
                    const tierColor = TIER_COLOR[u.loyaltyTier] ?? "#2DD4BF";
                    return (
                      <tr key={u.id} onClick={() => router.push(`/admin/${secret}/users/${u.id}`)} className="cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-semibold text-[color:var(--text-primary)]">{u.name || u.username}</p>
                          <p className="text-[11px] text-[color:var(--text-muted)]">{u.phone}</p>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[color:var(--text-secondary)] whitespace-nowrap">{u.accountNo}</td>
                        <td className="px-4 py-3 font-bold text-[color:var(--gold)] tabular-nums whitespace-nowrap">ETB {fmtETB(u.balance)}</td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                          {u.withdrawable > 0
                            ? <span className="text-[color:var(--green)] font-semibold">ETB {fmtETB(u.withdrawable)}</span>
                            : <span className="text-[color:var(--text-muted)]">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold" style={{ color: tierColor }}>{u.loyaltyTier}</span>
                        </td>
                        <td className="px-4 py-3">
                          {u.isActive
                            ? <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--green)]"><ShieldCheck className="w-3 h-3" /> Active</span>
                            : <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--red)]"><ShieldOff className="w-3 h-3" /> Banned</span>}
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-[color:var(--text-muted)] inline" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {data.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-[12px] text-[color:var(--text-muted)]">{data.total} total</p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-[color:var(--border-base)] text-[color:var(--text-secondary)] disabled:opacity-30 hover:border-[color:var(--border-accent)]">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] text-[color:var(--text-muted)] px-2 py-1.5">Page {page} / {data.pages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= data.pages}
                  className="p-1.5 rounded-lg border border-[color:var(--border-base)] text-[color:var(--text-secondary)] disabled:opacity-30 hover:border-[color:var(--border-accent)]">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
