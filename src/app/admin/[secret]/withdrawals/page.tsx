"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAdminFetch } from "../useAdmin";
import { toast } from "sonner";
import { Loader2, Check, X, ChevronLeft, ChevronRight, RefreshCw, Upload, Image as ImageIcon, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Withdrawal {
  id: string; publicId: string | null; userId: string; accountNo: number; username: string; name: string | null; phone: string;
  amount: number; hasProof: boolean; method: string; account: string; accountName: string;
  status: string; adminNote: string | null; createdAt: string;
  agentId: string | null; agentName: string | null;
  sla: { elapsedMinutes: number; breached: boolean; remainingMinutes: number } | null;
}

const STATUS_TABS = ["PENDING", "PROCESSING", "APPROVED", "REJECTED", "ALL"];

function fmtETB(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 2 }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

export default function WithdrawalsPage() {
  const { secret } = useParams<{ secret: string }>();
  const adminFetch = useAdminFetch();
  const [tab, setTab] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Withdrawal[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Withdrawal | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [uploadingProof, setUploadingProof] = useState(false);

  async function uploadProof(id: string, file: File) {
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/withdrawals/${id}/proof`, { method: "POST", headers: { "x-admin-secret": secret }, body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error ?? "Upload failed"); return; }
      toast.success("Proof uploaded — visible to the user for 2 days");
      setPreview((p) => (p ? { ...p, hasProof: true } : p));
      load();
    } finally { setUploadingProof(false); }
  }

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/withdrawals?status=${tab}&page=${page}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => toast.error("Failed to load withdrawals"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "reject" | "process", note?: string) {
    setActing(id);
    try {
      const res = await adminFetch(`/withdrawals/${id}`, {
        method: "POST",
        body: JSON.stringify({ action, note }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Action failed"); return; }
      toast.success(
        action === "approve" ? "Withdrawal approved — mark as paid"
        : action === "process" ? "Locked — the player can no longer cancel"
        : "Withdrawal rejected — balance refunded",
      );
      setPreview(null);
      load();
    } catch { toast.error("Network error"); }
    finally { setActing(null); }
  }

  return (
    <div className="p-5 sm:p-7 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Withdrawals</h1>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] text-[12px] font-semibold text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); setPage(1); }}
            className={cn("px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors border",
              tab === t ? "bg-[var(--bg-accent-dim)] border-[color:var(--border-accent)] text-[color:var(--gold)]"
                        : "border-[color:var(--border-base)] bg-[var(--bg-surface)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]")}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[color:var(--gold)]" /></div>
      ) : !data || data.items.length === 0 ? (
        <p className="text-[color:var(--text-muted)] text-sm py-12 text-center">No withdrawals found.</p>
      ) : (
        <>
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[color:var(--border-muted)]">
                    {["ID", "User", "Account ID", "Amount", "Method", "Agent", "Date", "Status", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-muted)]">
                  {data.items.map((w) => (
                    <tr key={w.id} onClick={() => { setPreview(w); setNoteInput(""); }} className="cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-bold text-[color:var(--gold)]">{w.publicId ?? "—"}</span>
                        {w.sla && (
                          <div className={cn(
                            "text-[10px] font-semibold mt-0.5",
                            w.sla.breached ? "text-[color:var(--red)]" : "text-[color:var(--text-muted)]",
                          )}>
                            {w.sla.breached ? `Late · ${w.sla.elapsedMinutes}m` : `${w.sla.elapsedMinutes}m`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)] whitespace-nowrap">
                        <div>{w.name || w.username}</div>
                        <div className="text-[11px] text-[color:var(--text-muted)]">{w.phone}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[color:var(--text-secondary)] whitespace-nowrap">{w.accountNo}</td>
                      <td className="px-4 py-3 font-bold text-[color:var(--red)] tabular-nums whitespace-nowrap">ETB {fmtETB(w.amount)}</td>
                      <td className="px-4 py-3 text-[color:var(--text-secondary)] capitalize">
                        <div>{w.method}</div>
                        <div className="text-[11px] text-[color:var(--text-muted)] font-mono normal-case">{w.account}</div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[color:var(--text-muted)] whitespace-nowrap">
                        {w.agentName ?? <span className="text-[color:var(--red)]">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">{fmtDate(w.createdAt)}</td>
                      <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                      <td className="px-4 py-3">
                        {(w.status === "PENDING" || w.status === "PROCESSING") && (
                          <div className="flex items-center gap-1.5">
                            {w.status === "PENDING" && (
                              <button onClick={(e) => { e.stopPropagation(); act(w.id, "process"); }} disabled={acting === w.id}
                                title="Lock the player's funds before sending money"
                                className="p-1.5 rounded-lg text-[color:var(--gold)] hover:bg-[var(--bg-accent-dim)] transition-colors disabled:opacity-40">
                                <Lock className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); act(w.id, "approve"); }} disabled={acting === w.id} title="Approve"
                              className="p-1.5 rounded-lg text-[color:var(--green)] hover:bg-[#2BD97420] transition-colors disabled:opacity-40">
                              {acting === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); act(w.id, "reject"); }} disabled={acting === w.id} title="Reject"
                              className="p-1.5 rounded-lg text-[color:var(--red)] hover:bg-[#FF3B5C20] transition-colors disabled:opacity-40">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
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

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-md rounded-3xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[16px] font-bold text-[color:var(--text-primary)]">Withdrawal — {preview.name || preview.username}</h2>
              <button onClick={() => setPreview(null)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1.5 text-[13px]">
              <Row label="Amount" value={`ETB ${fmtETB(preview.amount)}`} />
              <Row label="Method" value={preview.method} />
              <Row label="Account" value={preview.account} />
              <Row label="Account name" value={preview.accountName} />
              <Row label="Account ID" value={String(preview.accountNo)} />
              <Row label="Phone" value={preview.phone} />
              <Row label="Status" value={<StatusBadge status={preview.status} />} />
              {preview.adminNote && <Row label="Note" value={preview.adminNote} />}
              <Row label="Submitted" value={fmtDate(preview.createdAt)} />
            </div>

            {/* Payment proof — shown to the user, auto-deleted after 2 days */}
            {preview.status !== "REJECTED" && preview.status !== "CANCELLED" && (
              <div className="pt-1 border-t border-[color:var(--border-muted)]">
                <p className="text-[12px] font-semibold text-[color:var(--text-primary)] mb-1.5 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Payment proof</p>
                <p className="text-[11px] text-[color:var(--text-muted)] mb-2">
                  {preview.hasProof ? "Uploaded — visible to the user for 2 days." : "Upload the transfer screenshot to show the user. Auto-deleted after 2 days."}
                </p>
                <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] cursor-pointer">
                  {uploadingProof ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploadingProof ? "Uploading…" : preview.hasProof ? "Replace proof" : "Upload proof"}
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingProof}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(preview.id, f); e.target.value = ""; }} />
                </label>
              </div>
            )}

            {preview.status === "PENDING" && (
              <div className="space-y-2 pt-1">
                <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="Note (optional)"
                  className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => act(preview.id, "approve", noteInput || undefined)} disabled={!!acting}
                    className="h-10 rounded-xl bg-[#2BD97420] border border-[#2BD97455] text-[color:var(--green)] font-bold text-[13px] hover:bg-[#2BD97435] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                    {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Mark paid
                  </button>
                  <button onClick={() => act(preview.id, "reject", noteInput || undefined)} disabled={!!acting}
                    className="h-10 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C55] text-[color:var(--red)] font-bold text-[13px] hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { PENDING: "#F59E0B", PROCESSING: "#F5B400", APPROVED: "#2BD974", REJECTED: "#FF3B5C", CANCELLED: "#A79FB5" };
  const color = map[status] ?? "#A79FB5";
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-[0.04em]"
      style={{ color, background: `${color}20`, border: `1px solid ${color}44` }}>
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[color:var(--text-muted)] shrink-0">{label}</span>
      <span className="text-[color:var(--text-primary)] text-right">{value}</span>
    </div>
  );
}
