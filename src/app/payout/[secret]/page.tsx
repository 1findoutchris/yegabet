"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Check, X, Clock, AlertTriangle, RefreshCw, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePayoutFetch } from "./usePayout";

interface Sla {
  elapsedMinutes: number;
  breached: boolean;
  remainingMinutes: number;
}

export interface PayoutRequest {
  id: string;
  publicId: string | null;
  amount: number;
  method: string;
  account: string;
  accountName: string;
  status: string;
  accountNo: number;
  username: string;
  phone: string;
  hasProof: boolean;
  adminNote: string | null;
  createdAt: string;
  processingAt: string | null;
  paidAt: string | null;
  sla: Sla | null;
}

interface Me {
  name: string | null;
  username: string;
  methods: string[];
  commissionRate: number;
  slaMinutes: number;
  outstanding: number;
  commission: number;
  paidOut: number;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export function SlaBadge({ sla }: { sla: Sla | null }) {
  if (!sla) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
        sla.breached
          ? "bg-[#FF3B5C1A] text-[color:var(--red)] border border-[#FF3B5C44]"
          : "bg-[var(--bg-elevated)] text-[color:var(--text-muted)] border border-[color:var(--border-base)]",
      )}
    >
      {sla.breached ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {sla.breached ? `Late · ${sla.elapsedMinutes}m` : `${sla.remainingMinutes}m left`}
    </span>
  );
}

export default function PayoutQueuePage() {
  const { secret } = useParams<{ secret: string }>();
  const payoutFetch = usePayoutFetch();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, qRes] = await Promise.all([payoutFetch("/me"), payoutFetch("/queue")]);
      if (meRes.ok) setMe(await meRes.json());
      if (qRes.ok) setRows((await qRes.json()).requests);
    } catch {
      toast.error("Couldn't load your queue");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // The SLA clock is server-computed, so re-pull periodically rather than
  // ticking it locally and drifting.
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  /**
   * Attach the payment proof the player sees.
   *
   * Raw fetch, not payoutFetch: that helper forces a JSON content-type, which
   * would clobber the multipart boundary the upload needs.
   */
  async function uploadProof(id: string, file: File) {
    setUploading(id);
    try {
      const res = await fetch(`/api/payout/withdrawals/${id}/proof`, {
        method: "POST",
        headers: { "x-payout-secret": secret },
        body: (() => { const fd = new FormData(); fd.append("file", file); return fd; })(),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error ?? "Upload failed"); return; }
      toast.success("Proof attached — the player can see it now");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setUploading(null);
    }
  }

  async function act(id: string, action: "process" | "paid" | "reject") {
    if (acting) return;
    if (action === "reject" && !confirm("Reject this payout? The money goes back to the player.")) return;
    setActing(id);
    try {
      const res = await payoutFetch(`/withdrawals/${id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Action failed");
        return;
      }
      toast.success(
        action === "process" ? "Locked — the player can no longer cancel"
        : action === "paid" ? `Marked paid${d.commission ? ` · commission ${fmt(d.commission)}` : ""}`
        : "Rejected and refunded",
      );
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Payout queue</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            {me?.methods.join(" · ") || "No methods assigned"} · {me?.commissionRate}% commission · {me?.slaMinutes}m SLA
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)]">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Owed to the agent — they hold no float, so this is what they're due back. */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Owed to you", value: me?.outstanding ?? 0, color: "var(--gold)" },
          { label: "Commission earned", value: me?.commission ?? 0, color: "var(--green)" },
          { label: "Total paid out", value: me?.paidOut ?? 0, color: "var(--text-primary)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] p-3">
            <p className="text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
            <p className="font-display text-[16px] font-extrabold tabular-nums mt-0.5" style={{ color }}>
              ETB {fmt(value)}
            </p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-[13px] text-[color:var(--text-muted)] py-12">
          Nothing waiting. New requests for your methods land here automatically.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const locked = r.status === "PROCESSING";
            return (
              <div key={r.id} className={cn(
                "rounded-2xl border bg-[var(--bg-surface)] p-4",
                locked ? "border-[color:var(--gold)]/50" : "border-[color:var(--border-base)]",
              )}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[12px] font-bold text-[color:var(--gold)]">{r.publicId}</span>
                      <SlaBadge sla={r.sla} />
                      {locked && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--bg-accent-dim)] text-[color:var(--gold)] border border-[color:var(--border-accent)]">
                          <Lock className="w-3 h-3" /> Locked
                        </span>
                      )}
                    </div>
                    <p className="font-display text-[22px] font-extrabold tabular-nums text-[color:var(--text-primary)] mt-1.5">
                      ETB {fmt(r.amount)}
                    </p>
                    <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 capitalize">{r.method}</p>
                    <p className="text-[13px] font-semibold text-[color:var(--text-primary)] tabular-nums">{r.account}</p>
                    <p className="text-[12px] text-[color:var(--text-muted)]">{r.accountName} · @{r.username} · <span className="tabular-nums">{r.accountNo}</span></p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                    {!locked ? (
                      <button
                        onClick={() => act(r.id, "process")}
                        disabled={acting === r.id}
                        className="h-10 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        {acting === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                        Process
                      </button>
                    ) : (
                      <button
                        onClick={() => act(r.id, "paid")}
                        disabled={acting === r.id}
                        className="h-10 px-4 rounded-xl bg-[var(--green)] text-[#09090B] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        {acting === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Mark paid
                      </button>
                    )}
                    {locked && (
                      <label
                        className={cn(
                          "h-10 px-4 rounded-xl border font-bold text-[13px] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors",
                          r.hasProof
                            ? "bg-[#2BD9741A] border-[#2BD97444] text-[color:var(--green)]"
                            : "bg-[var(--bg-elevated)] border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)]",
                          uploading === r.id && "opacity-40 pointer-events-none",
                        )}
                      >
                        {uploading === r.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : r.hasProof ? <Check className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
                        {r.hasProof ? "Replace proof" : "Attach proof"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadProof(r.id, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                    <button
                      onClick={() => act(r.id, "reject")}
                      disabled={acting === r.id}
                      className="h-10 px-4 rounded-xl bg-[#FF3B5C1A] border border-[#FF3B5C44] text-[color:var(--red)] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>

                {!locked ? (
                  <p className="text-[11px] text-[color:var(--text-muted)] mt-3 pt-3 border-t border-[color:var(--border-muted)]">
                    Press <strong className="text-[color:var(--text-secondary)]">Process</strong> before you send the money —
                    it locks the player&apos;s funds so they can&apos;t cancel while the transfer is in flight.
                  </p>
                ) : (
                  <p className="text-[11px] text-[color:var(--text-muted)] mt-3 pt-3 border-t border-[color:var(--border-muted)]">
                    {r.hasProof
                      ? "Proof attached — the player can see it for 2 days."
                      : "Send the money, then attach the transfer screenshot so the player can see it was sent."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
