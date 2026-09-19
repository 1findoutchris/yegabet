"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Save, Check, Plus, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useSpin, FIELD, KIND_LABEL, toBps, toPct,
  type Prize, type PrizeKind,
} from "./shared";

/* Prizes tab. Per-row saves against /api/admin/spin — a table, not a
   reward-config block, because stock is live state. */

export default function SpinPrizesPage() {
  const { secret } = useParams<{ secret: string }>();
  const { prizes, setPrizes, loading, error, setError, adminFetch, reload } = useSpin();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  function setField<K extends keyof Prize>(id: string, key: K, value: Prize[K]) {
    setPrizes((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
  }

  async function savePrize(p: Prize) {
    setSavingId(p.id);
    setError("");
    const res = await adminFetch("/spin", {
      method: "PATCH",
      body: JSON.stringify({
        id: p.id, label: p.label, kind: p.kind, cashEtb: p.cashEtb,
        creditsAwarded: p.creditsAwarded, payoutPot: p.payoutPot,
        weightBps: p.weightBps, stock: p.stock,
        sortOrder: p.sortOrder, isActive: p.isActive,
      }),
    });
    setSavingId(null);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Save failed."); return; }
    setSavedId(p.id);
    setTimeout(() => setSavedId((s) => (s === p.id ? null : s)), 1800);
  }

  async function addPrize() {
    setError("");
    const fd = new FormData();
    fd.append("label", "New prize");
    fd.append("kind", "CASH");
    fd.append("cashEtb", "0");
    fd.append("creditsAwarded", "0");
    fd.append("payoutPot", "bonus");
    fd.append("weightBps", "0");
    fd.append("stock", "0");
    fd.append("sortOrder", String(prizes.length));
    fd.append("isActive", "true");
    // Raw fetch, not adminFetch — adminFetch forces a JSON content-type, which
    // would clobber the multipart boundary.
    const res = await fetch("/api/admin/spin", {
      method: "POST", headers: { "x-admin-secret": secret }, body: fd,
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not add prize."); return; }
    reload();
  }

  async function uploadImage(id: string, file: File) {
    setError("");
    // Raw fetch again — multipart boundary must survive.
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/spin/image?id=${id}`, {
      method: "POST", headers: { "x-admin-secret": secret }, body: fd,
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Upload failed."); return; }
    reload();
  }

  async function removePrize(id: string) {
    if (!confirm("Delete this prize? Past wins keep their record.")) return;
    await adminFetch(`/spin?id=${id}`, { method: "DELETE" });
    reload();
  }

  // The one number that catches a catastrophic misconfiguration before it ships.
  const active = prizes.filter((p) => p.isActive);
  const evPerSpin = active.reduce((sum, p) => sum + (p.weightBps / 10000) * p.cashEtb, 0);
  const totalPct = active.reduce((sum, p) => sum + toPct(p.weightBps), 0);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>}

      {/* Cost readout — the guard against a bad chance table */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Expected cash cost per spin</p>
          <p className={cn("text-[24px] font-bold mt-1", evPerSpin > 500 ? "text-[color:var(--red)]" : "text-[color:var(--text-primary)]")}>
            ETB {evPerSpin.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-[color:var(--text-muted)] mt-1">
            What the average spin pays out. Multiply by expected spins to size the liability.
          </p>
        </div>
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Total win chance</p>
          <p className={cn("text-[24px] font-bold mt-1", totalPct > 100 ? "text-[color:var(--red)]" : "text-[color:var(--text-primary)]")}>
            {totalPct.toFixed(2)}%
          </p>
          <p className="text-[11px] text-[color:var(--text-muted)] mt-1">
            The remaining {Math.max(0, 100 - totalPct).toFixed(2)}% is the &ldquo;try again&rdquo; slice.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">Prizes</h2>
          <button onClick={addPrize}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] text-[color:var(--text-secondary)]">
            <Plus className="w-4 h-4" /> Add prize
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] text-left">
                <th className="pb-2 pr-2 w-[64px]">Image</th>
                <th className="pb-2 pr-2 min-w-[150px]">Label</th>
                <th className="pb-2 pr-2 w-[120px]">Type</th>
                <th className="pb-2 pr-2 w-[110px]">Cash ETB</th>
                <th className="pb-2 pr-2 w-[80px]">Spins</th>
                <th className="pb-2 pr-2 w-[130px]">Pays into</th>
                <th className="pb-2 pr-2 w-[100px]">Chance %</th>
                <th className="pb-2 pr-2 w-[100px]">Stock</th>
                <th className="pb-2 pr-2 w-[70px]">Order</th>
                <th className="pb-2 pr-2 w-[60px]">Live</th>
                <th className="pb-2 w-[90px]" />
              </tr>
            </thead>
            <tbody>
              {prizes.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--border-muted)]">
                  <td className="py-2 pr-2">
                    <label className="cursor-pointer block w-11 h-11 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] grid place-items-center overflow-hidden">
                      {p.imageUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                        : <Upload className="w-4 h-4 text-[color:var(--text-muted)]" />}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(p.id, f); e.target.value = ""; }} />
                    </label>
                  </td>
                  <td className="py-2 pr-2">
                    <input className={FIELD} value={p.label}
                      onChange={(e) => setField(p.id, "label", e.target.value)} />
                  </td>
                  <td className="py-2 pr-2">
                    <select className={FIELD} value={p.kind}
                      onChange={(e) => setField(p.id, "kind", e.target.value as PrizeKind)}>
                      {(Object.keys(KIND_LABEL) as PrizeKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min={0} className={FIELD}
                      value={p.cashEtb} disabled={p.kind !== "CASH"}
                      onChange={(e) => setField(p.id, "cashEtb", Number(e.target.value))} />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min={0} max={50} className={FIELD}
                      value={p.creditsAwarded} disabled={p.kind !== "SPIN"}
                      onChange={(e) => setField(p.id, "creditsAwarded", Number(e.target.value))} />
                  </td>
                  <td className="py-2 pr-2">
                    <select className={FIELD} value={p.payoutPot} disabled={p.kind !== "CASH"}
                      onChange={(e) => setField(p.id, "payoutPot", e.target.value as Prize["payoutPot"])}>
                      <option value="bonus">Bonus (locked)</option>
                      <option value="withdrawable">Withdrawable</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min={0} max={100} step="0.01" className={FIELD}
                      value={toPct(p.weightBps)}
                      onChange={(e) => setField(p.id, "weightBps", toBps(Number(e.target.value)))} />
                    {p.weightBps === 0 && p.isActive && (
                      // A 0% prize still shows on the wheel but can never
                      // land. Surfaced so it's a deliberate choice, not a typo.
                      <span className="block text-[10px] text-[color:var(--text-muted)] mt-0.5">shown, never wins</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min={0} className={FIELD} value={p.stock}
                      disabled={p.kind === "NONE"}
                      title={p.kind === "NONE" ? "Try again is never used up" : undefined}
                      onChange={(e) => setField(p.id, "stock", Number(e.target.value))} />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" min={0} className={FIELD} value={p.sortOrder}
                      onChange={(e) => setField(p.id, "sortOrder", Number(e.target.value))} />
                  </td>
                  <td className="py-2 pr-2 text-center">
                    <input type="checkbox" checked={p.isActive}
                      onChange={(e) => setField(p.id, "isActive", e.target.checked)} />
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => savePrize(p)} disabled={savingId === p.id} title="Save"
                        className={cn("w-8 h-8 grid place-items-center rounded-lg",
                          savedId === p.id ? "text-[color:var(--green)]" : "text-[color:var(--gold)] hover:bg-[var(--bg-elevated)]")}>
                        {savingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" />
                          : savedId === p.id ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                      </button>
                      <button onClick={() => removePrize(p.id)} title="Delete"
                        className="w-8 h-8 grid place-items-center rounded-lg text-[color:var(--red)] hover:bg-[var(--bg-elevated)]">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-[11px] text-[color:var(--text-muted)] mt-3 space-y-1">
          <li>
            <b>Withdrawable</b> pays real cash the player can take out immediately.
            <b> Bonus</b> is playable but must be wagered first — the default everywhere else in the app.
          </li>
          <li>
            <b>Try again</b> is a losing wedge. Give it a chance % like any prize; it is never
            used up, so its stock is ignored. Whatever chance is left below 100% also loses,
            but with no wedge to land on — so it reads better if the try-again rows take up the
            remainder.
          </li>
          <li>
            <b>Free spins</b> hands the player more coupons instead of money.
          </li>
          <li>
            Chance <b>0%</b> keeps a prize on the wheel but makes it unwinnable — useful as a
            display piece. Players are not told it can&rsquo;t be won.
          </li>
        </ul>
      </div>
    </div>
  );
}
