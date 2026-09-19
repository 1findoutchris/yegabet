"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Loader2, Trash2, RefreshCw } from "lucide-react";
import { useAdminFetch } from "../useAdmin";
import { cn } from "@/lib/utils";

interface SmsRow {
  key: string;
  kind: "unmatched" | "unparsed" | "rejected";
  label: string;
  ref: string | null;
  amount: number | null;
  method: string | null;
  sender: string | null;
  rawMessage: string;
  reason: string | null;
  receivedAt: string | null;
  ttlSeconds: number;
}

const KIND_COLOR: Record<SmsRow["kind"], string> = {
  unmatched: "var(--gold)",
  unparsed: "var(--text-muted)",
  rejected: "var(--red)",
};

/** "3h 12m" from a TTL, so it's obvious how long a message has left. */
function expiresIn(seconds: number): string {
  if (seconds < 0) return "no expiry";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function SmsPage() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/sms");
      if (!res.ok) throw new Error();
      setRows((await res.json()).messages);
    } catch {
      setErr("Failed to load messages.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function removeOne(key: string) {
    setBusy(key);
    setErr("");
    const res = await adminFetch(`/sms?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { setErr("Could not delete that message."); return; }
    // Drop it locally instead of refetching the whole list.
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function removeAll() {
    if (!confirm(`Delete all ${rows.length} unmatched message(s)? This cannot be undone.`)) return;
    setBusy("all");
    setErr("");
    const res = await adminFetch("/sms?all=1", { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { setErr("Could not clear messages."); return; }
    setRows([]);
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
            <MessageSquareText className="w-5 h-5 text-[color:var(--gold)]" />
            Unmatched SMS
          </h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Agent messages the auto-matcher couldn&rsquo;t pair with a pending deposit. They expire on
            their own after 24 hours — deleting is only for clearing noise.
          </p>
        </div>
        <button onClick={load} disabled={loading} title="Refresh"
          className="w-10 h-10 shrink-0 grid place-items-center rounded-xl text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {err && (
        <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{err}</p>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-3">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {rows.length} message{rows.length === 1 ? "" : "s"}
          </p>
          <button onClick={removeAll} disabled={busy === "all"}
            className="ml-auto inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] text-[13px] font-bold hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40">
            {busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete all
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-muted)] text-center py-10">
          Nothing unmatched right now.
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key} className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.05em]" style={{ color: KIND_COLOR[r.kind] }}>
                      {r.label}
                    </span>
                    {r.amount !== null && (
                      <span className="text-[12px] font-bold text-[color:var(--text-primary)] tabular-nums">
                        ETB {r.amount.toLocaleString()}
                      </span>
                    )}
                    {r.method && <span className="text-[11px] text-[color:var(--text-muted)]">{r.method}</span>}
                    {r.ref && <span className="text-[11px] font-mono text-[color:var(--text-muted)]">{r.ref}</span>}
                  </div>

                  <p className="text-[12px] text-[color:var(--text-secondary)] whitespace-pre-wrap break-words">
                    {r.rawMessage || <span className="italic text-[color:var(--text-muted)]">(empty message)</span>}
                  </p>

                  <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
                    {r.sender && <>from {r.sender} · </>}
                    {r.receivedAt && <>{new Date(r.receivedAt).toLocaleString()} · </>}
                    expires in {expiresIn(r.ttlSeconds)}
                  </p>
                </div>

                <button onClick={() => removeOne(r.key)} disabled={busy === r.key} title="Delete"
                  className="w-9 h-9 shrink-0 grid place-items-center rounded-xl text-[color:var(--red)] hover:bg-[var(--bg-elevated)] disabled:opacity-40">
                  {busy === r.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
