"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Megaphone, Trash2, Upload, Pause, Play, Save, Check } from "lucide-react";
import { useAdminFetch } from "../useAdmin";
import { cn } from "@/lib/utils";

interface Ad {
  id: string;
  placement: "BOARD" | "POPUP";
  linkUrl: string;
  expiresAt: string;
  isActive: boolean;
  sortOrder: number;
  expired: boolean;
  imageUrl: string;
}

export default function AdsPage() {
  const adminFetch = useAdminFetch();
  const { secret } = useParams<{ secret: string }>();
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // New-ad form
  const [placement, setPlacement] = useState<"BOARD" | "POPUP">("BOARD");
  const [expiresAt, setExpiresAt] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/promos");
      if (!res.ok) throw new Error();
      setAds((await res.json()).ads);
    } catch {
      setErr("Failed to load ads.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!file || !expiresAt) { setErr("Pick an image and an expiry date."); return; }
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("placement", placement);
    fd.append("expiresAt", expiresAt);
    fd.append("linkUrl", linkUrl.trim());
    // No Content-Type header — the browser sets the multipart boundary.
    const res = await fetch("/api/admin/promos", { method: "POST", headers: { "x-admin-secret": secret }, body: fd });
    setBusy(false);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Upload failed."); return; }
    setFile(null); setLinkUrl(""); setExpiresAt("");
    load();
  }

  // Local edits only; nothing reaches the server until the row is saved.
  function setField<K extends keyof Ad>(id: string, key: K, value: Ad[K]) {
    setAds((prev) => prev.map((a) => (a.id === id ? { ...a, [key]: value } : a)));
  }

  async function save(ad: Ad) {
    setSavingId(ad.id);
    setErr("");
    const res = await adminFetch("/promos", {
      method: "PATCH",
      body: JSON.stringify({
        id: ad.id,
        placement: ad.placement,
        linkUrl: ad.linkUrl.trim(),
        expiresAt: ad.expiresAt,
        isActive: ad.isActive,
        sortOrder: ad.sortOrder,
      }),
    });
    setSavingId(null);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Could not save."); return; }
    setSavedId(ad.id);
    setTimeout(() => setSavedId((s) => (s === ad.id ? null : s)), 1800);
    load();
  }

  async function toggle(ad: Ad) {
    await adminFetch("/promos", { method: "PATCH", body: JSON.stringify({ id: ad.id, isActive: !ad.isActive }) });
    load();
  }

  // Multipart, so a raw fetch — adminFetch forces a JSON content-type that
  // would clobber the boundary.
  async function replaceImage(id: string, f: File) {
    setSavingId(id);
    setErr("");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(`/api/admin/promos/image?id=${id}`, {
      method: "POST", headers: { "x-admin-secret": secret }, body: fd,
    });
    setSavingId(null);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Image upload failed."); return; }
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this ad?")) return;
    await adminFetch(`/promos?id=${id}`, { method: "DELETE" });
    load();
  }

  const field = "w-full h-11 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)]";

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-[color:var(--gold)]" /> Ads
        </h1>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
          Image-only. Board ads swipe across the top of the lobby; popup ads show once per day.
          Best results at a wide 3:1 image for the board and a portrait 4:5 for popups.
        </p>
      </div>

      {err && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{err}</p>}

      {/* New ad */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <select value={placement} onChange={(e) => setPlacement(e.target.value as "BOARD" | "POPUP")} className={field}>
            <option value="BOARD">Board (lobby banner)</option>
            <option value="POPUP">Popup</option>
          </select>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={field} />
        </div>
        <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Click-through link (optional)" className={field} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-4 h-11 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] text-[color:var(--text-secondary)] cursor-pointer">
            <Upload className="w-4 h-4" /> {file ? file.name : "Choose image"}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button onClick={create} disabled={busy}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-gold-grad text-[#09090B] text-[13px] font-bold disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add ad"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      ) : ads.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-muted)] text-center py-10">No ads yet.</p>
      ) : (
        <div className="space-y-3">
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-3 space-y-3">
              <div className="flex items-start gap-3">
                {/* Click the thumbnail to swap the image in place */}
                <label className="relative shrink-0 cursor-pointer group" title="Replace image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ad.imageUrl} alt="" className="w-24 h-16 object-cover rounded-lg bg-[var(--bg-elevated)]" />
                  <span className="absolute inset-0 rounded-lg bg-black/55 opacity-0 group-hover:opacity-100 grid place-items-center transition-opacity">
                    <Upload className="w-4 h-4 text-white" />
                  </span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) replaceImage(ad.id, f); e.target.value = ""; }} />
                </label>

                <div className="min-w-0 flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <select className={field} value={ad.placement}
                    onChange={(e) => setField(ad.id, "placement", e.target.value as Ad["placement"])}>
                    <option value="BOARD">Board</option>
                    <option value="POPUP">Popup</option>
                  </select>
                  <input type="date" className={field} value={ad.expiresAt}
                    onChange={(e) => setField(ad.id, "expiresAt", e.target.value)} />
                  <input type="number" min={0} className={field} value={ad.sortOrder} title="Carousel order — lower shows first"
                    onChange={(e) => setField(ad.id, "sortOrder", Number(e.target.value))} />
                  <input type="url" className={cn(field, "col-span-2 sm:col-span-1")} placeholder="Link (optional)"
                    value={ad.linkUrl} onChange={(e) => setField(ad.id, "linkUrl", e.target.value)} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={cn("text-[11px] font-semibold",
                  ad.expired ? "text-[color:var(--text-muted)]"
                    : ad.isActive ? "text-[color:var(--green)]" : "text-[color:var(--text-muted)]")}>
                  {ad.expired ? "Expired" : ad.isActive ? "Live" : "Paused"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => save(ad)} disabled={savingId === ad.id}
                    className={cn("inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-[12px] font-bold",
                      savedId === ad.id ? "bg-[var(--green)] text-[#09090B]" : "bg-gold-grad text-[#09090B]")}>
                    {savingId === ad.id ? <Loader2 className="w-4 h-4 animate-spin" />
                      : savedId === ad.id ? <><Check className="w-4 h-4" /> Saved</>
                      : <><Save className="w-4 h-4" /> Save</>}
                  </button>
                  <button onClick={() => toggle(ad)} title={ad.isActive ? "Pause" : "Resume"}
                    className="w-9 h-9 grid place-items-center rounded-xl text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)]">
                    {ad.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button onClick={() => remove(ad.id)} title="Delete"
                    className="w-9 h-9 grid place-items-center rounded-xl text-[color:var(--red)] hover:bg-[var(--bg-elevated)]">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
