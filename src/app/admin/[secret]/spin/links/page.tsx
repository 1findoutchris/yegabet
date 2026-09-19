"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Trash2, Link as LinkIcon, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpin, FIELD, KIND_LABEL } from "../shared";

/* Guaranteed-win links tab. The prize list comes from the same /spin read the
   prizes tab uses; the links themselves live at /spin/links. */

interface SpinLink {
  id: string;
  code: string;
  prizeLabel: string;
  note: string | null;
  prizeLive: boolean;
  cashEtb: number;
  payoutPot: string | null;
  status: "UNCLAIMED" | "CLAIMED" | "WON";
  claimedBy: string | null;
  claimedByAccountNo: number | null;
  claimedAt: string | null;
  createdAt: string;
}

const LINK_STATUS: Record<SpinLink["status"], { label: string; color: string }> = {
  UNCLAIMED: { label: "Unclaimed", color: "var(--text-muted)" },
  CLAIMED: { label: "Claimed — awaiting spin", color: "var(--gold)" },
  WON: { label: "Won", color: "var(--green)" },
};

/** Mirrors the server cap in /api/admin/spin/links. */
const MAX_BATCH = 100;

export default function SpinLinksPage() {
  const { prizes, loading: prizesLoading, error, setError, adminFetch } = useSpin();
  const [links, setLinks] = useState<SpinLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [prizeId, setPrizeId] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState("1");
  const [justCreated, setJustCreated] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/spin/links");
      if (!res.ok) throw new Error();
      setLinks((await res.json()).links);
    } catch {
      setError("Failed to load links.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const selectedPrize = prizes.find((p) => p.id === prizeId);
  // What the batch costs if every link is claimed AND spun. Cash prizes only —
  // a physical prize's real cost isn't in the database.
  const exposure = (selectedPrize?.cashEtb ?? 0) * (parseInt(count, 10) || 0);

  async function createLink() {
    if (!prizeId) { setError("Pick a prize for the link."); return; }
    const n = parseInt(count, 10);
    if (isNaN(n) || n < 1) { setError("How many links? Enter 1 or more."); return; }
    if (n > MAX_BATCH) { setError(`At most ${MAX_BATCH} links at a time.`); return; }
    if (n > 1 && !confirm(
      `Generate ${n} links for "${selectedPrize?.label}"?\n\n` +
      `Each one guarantees that prize to whoever signs up with it` +
      (exposure > 0 ? `, so this is up to ETB ${exposure.toLocaleString()} in total.` : ".")
    )) return;

    setCreating(true);
    setError("");
    setJustCreated([]);
    const res = await adminFetch("/spin/links", {
      method: "POST",
      body: JSON.stringify({ prizeId, note: note.trim() || undefined, count: n }),
    });
    setCreating(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not create link."); return; }

    // Surfaced immediately: with a batch you need all the URLs at once, and
    // picking them out of a 200-row table one at a time is unusable.
    const body = await res.json().catch(() => ({} as { codes?: string[] }));
    setJustCreated(body.codes ?? []);
    setNote("");
    loadLinks();
  }

  async function copyAll() {
    const urls = justCreated.map((c) => `${origin}/?promo=${c}`).join("\n");
    try {
      await navigator.clipboard.writeText(urls);
      setCopiedId("__all__");
      setTimeout(() => setCopiedId((c) => (c === "__all__" ? null : c)), 1800);
    } catch {
      setError("Couldn't copy — select the links above and copy manually.");
    }
  }

  async function copyLink(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(`${origin}/?promo=${code}`);
      setCopiedId(id);
      // Revert only if this row is still the copied one, so copying a second
      // link doesn't get its badge cleared by the first one's timer.
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
    } catch {
      // clipboard needs a secure context; http://<lan-ip> in dev has none.
      setError("Couldn't copy — copy the link manually from the address bar.");
    }
  }

  async function deleteLink(id: string) {
    if (!confirm("Delete this unclaimed link?")) return;
    const res = await adminFetch(`/spin/links?id=${id}`, { method: "DELETE" });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not delete."); return; }
    loadLinks();
  }

  if (loading || prizesLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>}

      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
        <h2 className="text-[15px] font-bold text-[color:var(--text-primary)] mb-1">Guaranteed-win links</h2>
        <p className="text-[11px] text-[color:var(--text-muted)] mb-2">
          The first person to sign up through a link wins the chosen prize on their spin, then the
          link dies. They also get the normal signup spins, so the guaranteed one is their first.
        </p>
        <p className="text-[11px] text-[color:var(--red)] mb-3">
          This pays out even when the prize is out of stock, and a withdrawable cash prize is real
          money the winner can take out immediately. Anyone who gets the URL and signs up first
          takes it — there is no binding to a specific person.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <select className={cn(FIELD, "flex-1 min-w-[180px]")} value={prizeId}
            onChange={(e) => setPrizeId(e.target.value)}>
            <option value="">Choose a prize…</option>
            {prizes.filter((p) => p.kind !== "NONE").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}{p.kind === "CASH" ? ` · ${p.cashEtb} ETB ${p.payoutPot}` : ` · ${KIND_LABEL[p.kind]}`}
              </option>
            ))}
          </select>
          <input className={cn(FIELD, "flex-1 min-w-[160px]")} placeholder="Who is this for? (optional)"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <input
            type="number" min={1} max={MAX_BATCH}
            className={cn(FIELD, "w-24")}
            title="How many people — each gets their own single-use link"
            value={count} onChange={(e) => setCount(e.target.value)} />
          <button onClick={createLink} disabled={creating}
            className="inline-flex items-center gap-2 px-4 h-9 rounded-xl bg-gold-grad text-[#09090B] text-[13px] font-bold disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />} Generate
          </button>
        </div>

        {/* The number that actually matters before clicking Generate. */}
        {exposure > 0 && (
          <p className={cn("text-[11px] -mt-2 mb-4",
            exposure > 50_000 ? "text-[color:var(--red)] font-semibold" : "text-[color:var(--text-muted)]")}>
            {count} × {selectedPrize?.label} — up to <b>ETB {exposure.toLocaleString()}</b> if every
            link is claimed and spun.
          </p>
        )}

        {/* A batch is unusable if you have to dig the URLs out of the table one
            row at a time, so the new ones are listed here ready to hand out. */}
        {justCreated.length > 0 && (
          <div className="mb-4 rounded-xl border border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[12px] font-bold text-[color:var(--text-primary)]">
                {justCreated.length} link{justCreated.length === 1 ? "" : "s"} generated
              </p>
              <button onClick={copyAll}
                className={cn("inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-semibold transition-colors",
                  copiedId === "__all__" ? "text-[color:var(--green)]" : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)]")}>
                {copiedId === "__all__"
                  ? <><Check className="w-3.5 h-3.5" /> Copied</>
                  : <><Copy className="w-3.5 h-3.5" /> Copy all</>}
              </button>
            </div>
            <textarea
              readOnly
              rows={Math.min(justCreated.length, 6)}
              className="w-full rounded-lg bg-[var(--bg-base)] border border-[color:var(--border-muted)] p-2 text-[11px] font-mono text-[color:var(--text-secondary)] resize-y"
              value={justCreated.map((c) => `${origin}/?promo=${c}`).join("\n")}
            />
            <p className="text-[10px] text-[color:var(--text-muted)] mt-1.5">
              Give one to each person. Whoever signs up with a link first wins it — so send each
              one privately, and don&rsquo;t post them anywhere shared.
            </p>
          </div>
        )}

        {links.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-muted)] text-center py-6">No links yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[color:var(--text-muted)] border-b border-[color:var(--border-muted)]">
                  <th className="pb-2 pr-2">Prize</th>
                  <th className="pb-2 pr-2">For</th>
                  <th className="pb-2 pr-2">Status</th>
                  <th className="pb-2 pr-2">Claimed by</th>
                  <th className="pb-2 pr-2">Account ID</th>
                  <th className="pb-2 pr-2 w-[90px]"></th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-b border-[color:var(--border-muted)]">
                    <td className="py-2 pr-2 text-[color:var(--text-primary)]">
                      {l.prizeLabel}
                      {!l.prizeLive && (
                        <span className="block text-[10px] text-[color:var(--red)]">
                          prize inactive — link stays pending until it&rsquo;s back
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-[color:var(--text-muted)]">{l.note ?? "—"}</td>
                    <td className="py-2 pr-2 font-semibold" style={{ color: LINK_STATUS[l.status].color }}>
                      {LINK_STATUS[l.status].label}
                    </td>
                    <td className="py-2 pr-2 text-[color:var(--text-muted)]">{l.claimedBy ?? "—"}</td>
                    <td className="py-2 pr-2 text-[color:var(--text-secondary)] tabular-nums">
                      {l.claimedByAccountNo ?? "—"}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => copyLink(l.id, l.code)}
                          title="Copy signup link"
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-semibold transition-colors",
                            copiedId === l.id
                              ? "text-[color:var(--green)]"
                              : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                          )}>
                          {copiedId === l.id
                            ? <><Check className="w-4 h-4" /> Copied</>
                            : <><Copy className="w-4 h-4" /> Copy</>}
                        </button>
                        {l.status === "UNCLAIMED" && (
                          <button onClick={() => deleteLink(l.id)} title="Delete"
                            className="w-8 h-8 grid place-items-center rounded-lg text-[color:var(--red)] hover:bg-[var(--bg-elevated)]">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
