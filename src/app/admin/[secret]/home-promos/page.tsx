"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEST_TYPES, PROMO_LAYOUTS, PROMO_SLOTS, QUICK_DESTINATIONS, imageProblem, validDestination,
  type DestType, type PromoLayout, type PromoSlot,
} from "@/lib/homePromoCore";
import { PromoPanel } from "@/components/vinna/PromoSlot";
import type { PublicPromo } from "@/lib/homePromos";
import { useAdminFetch } from "../useAdmin";

type Promo = {
  id: string; title: string; heading: string | null; description: string | null;
  hasImage: boolean; hasMobileImage: boolean; imageAlt: string | null; ctaLabel: string | null;
  destType: DestType; destUrl: string | null; layout: PromoLayout; slot: PromoSlot;
  sortOrder: number; isActive: boolean; startsAt: string | null; endsAt: string | null;
  hiddenReason: string | null; preview: PublicPromo;
};

const input = "h-9 w-full px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";

export default function HomePromosPage() {
  const adminFetch = useAdminFetch();
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [storage, setStorage] = useState(true);
  const [editing, setEditing] = useState<Promo | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch("/home-promos");
    if (!res.ok) { toast.error("Could not load promotions"); return; }
    const j = await res.json();
    setPromos(j.promos);
    setStorage(j.storage);
  }, [adminFetch]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: object) {
    setBusy(true);
    try {
      const res = await adminFetch("/home-promos", { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? "Could not save");
      await load();
    } finally {
      setBusy(false);
    }
  }

  /** Swap a promotion with its neighbour inside the same placement. */
  function move(p: Promo, dir: -1 | 1) {
    const inSlot = (promos ?? []).filter((x) => x.slot === p.slot);
    const i = inSlot.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= inSlot.length) return;
    const next = [...inSlot];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ order: next.map((x, k) => ({ id: x.id, slot: x.slot, sortOrder: k })) });
  }

  async function remove(p: Promo) {
    if (!confirm(`Delete "${p.title}"? This can't be undone — switch it off instead to keep it.`)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/home-promos?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!res.ok) toast.error("Could not delete");
      else toast.success("Deleted");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Homepage Promos</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Banners and posters placed between the lobby&apos;s game sections. Only complete, switched-on promotions inside their dates are shown.
          </p>
        </div>
        <button onClick={() => setEditing("new")}
          className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] flex items-center gap-1.5 shrink-0">
          <Plus className="w-4 h-4" /> New promotion
        </button>
      </div>

      {!storage && (
        <p className="text-[12px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">
          Image storage isn&apos;t configured, so image uploads will fail. Text promotions still work.
        </p>
      )}

      {editing && (
        <PromoEditor
          promo={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}

      {!promos ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      ) : (
        PROMO_SLOTS.map((slot) => {
          const list = promos.filter((p) => p.slot === slot.id);
          return (
            <section key={slot.id} className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
              <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">{slot.label}</h2>
              {list.length === 0 && <p className="text-[12px] text-[color:var(--text-muted)]">Nothing here — this spot is skipped on the homepage.</p>}
              {list.map((p, i) => (
                <div key={p.id} className="flex flex-col md:flex-row gap-3 border-t border-[color:var(--border-muted)] pt-3">
                  <div className="md:w-[320px] shrink-0 pointer-events-none">
                    <PromoPanel promo={p.preview} shape={p.layout === "poster" ? "poster" : "banner"} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">{p.title}</p>
                      <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide",
                        p.hiddenReason ? "text-[color:var(--text-muted)] bg-[var(--bg-elevated)]" : "text-[color:var(--green)] bg-[#2BD97420]")}>
                        {p.hiddenReason ? `Hidden · ${p.hiddenReason}` : "Live"}
                      </span>
                    </div>
                    <p className="text-[12px] text-[color:var(--text-muted)]">
                      {PROMO_LAYOUTS.find((l) => l.id === p.layout)?.label} · {p.destUrl ?? "no destination"}
                      {(p.startsAt || p.endsAt) && <> · {p.startsAt ? new Date(p.startsAt).toLocaleString() : "now"} → {p.endsAt ? new Date(p.endsAt).toLocaleString() : "no end"}</>}
                    </p>
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      <label className="flex items-center gap-2 text-[12px] text-[color:var(--text-secondary)] mr-2">
                        <input type="checkbox" checked={p.isActive} disabled={busy} onChange={(e) => patch({ id: p.id, isActive: e.target.checked })} />
                        Active
                      </label>
                      <IconBtn label="Move up" disabled={busy || i === 0} onClick={() => move(p, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Move down" disabled={busy || i === list.length - 1} onClick={() => move(p, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Edit" disabled={busy} onClick={() => setEditing(p)}><Pencil className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Delete" disabled={busy} onClick={() => remove(p)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="w-8 h-8 grid place-items-center rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] disabled:opacity-30">
      {children}
    </button>
  );
}

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function PromoEditor({ promo, onClose, onSaved }: { promo: Promo | null; onClose: () => void; onSaved: () => void }) {
  // Plain fetch for the multipart save: the browser must set the
  // Content-Type itself (with the form boundary), which adminFetch overrides.
  const { secret } = useParams<{ secret: string }>();
  const [f, setF] = useState({
    title: promo?.title ?? "",
    heading: promo?.heading ?? "",
    description: promo?.description ?? "",
    imageAlt: promo?.imageAlt ?? "",
    ctaLabel: promo?.ctaLabel ?? "",
    destType: (promo?.destType ?? "internal") as DestType,
    destUrl: promo?.destUrl ?? "",
    layout: (promo?.layout ?? "banner") as PromoLayout,
    slot: (promo?.slot ?? "after_first") as PromoSlot,
    sortOrder: promo?.sortOrder ?? 0,
    isActive: promo?.isActive ?? false,
    startsAt: toLocal(promo?.startsAt ?? null),
    endsAt: toLocal(promo?.endsAt ?? null),
  });
  const [image, setImage] = useState<File | null>(null);
  const [mobile, setMobile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [removeMobile, setRemoveMobile] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // Local previews of freshly chosen files.
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  const mobileUrl = useMemo(() => (mobile ? URL.createObjectURL(mobile) : null), [mobile]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  useEffect(() => () => { if (mobileUrl) URL.revokeObjectURL(mobileUrl); }, [mobileUrl]);

  const preview: PublicPromo = {
    id: promo?.id ?? "new",
    heading: f.heading.trim() || null,
    description: f.description.trim() || null,
    imageUrl: imageUrl ?? (!removeImage ? promo?.preview.imageUrl ?? null : null),
    mobileImageUrl: mobileUrl ?? (!removeMobile ? promo?.preview.mobileImageUrl ?? null : null),
    imageAlt: f.imageAlt || f.heading,
    ctaLabel: f.ctaLabel.trim() || null,
    href: "#",
    external: false,
    layout: f.layout,
  };
  const destOk = !f.destUrl || validDestination(f.destType, f.destUrl.trim());

  function pick(setter: (file: File | null) => void, file: File | null) {
    if (file) {
      const problem = imageProblem(file);
      if (problem) { toast.error(problem); return; }
    }
    setter(file);
  }

  async function save() {
    if (!f.title.trim()) { toast.error("Internal title is required"); return; }
    if (!destOk) { toast.error("Fix the destination link"); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      if (promo) fd.set("id", promo.id);
      for (const [k, v] of Object.entries(f)) {
        if (k === "startsAt" || k === "endsAt") fd.set(k, v ? new Date(String(v)).toISOString() : "");
        else fd.set(k, String(v));
      }
      if (image) fd.set("image", image);
      if (mobile) fd.set("mobileImage", mobile);
      if (removeImage) fd.set("removeImage", "true");
      if (removeMobile) fd.set("removeMobileImage", "true");
      const res = await fetch("/api/admin/home-promos", { method: promo ? "PUT" : "POST", body: fd, headers: { "x-admin-secret": secret } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "Could not save"); return; }
      toast.success(j.hiddenReason ? `Saved — hidden on the homepage: ${j.hiddenReason}` : "Saved — live on the homepage");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border-accent)] bg-[var(--bg-surface)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">{promo ? "Edit promotion" : "New promotion"}</h2>
        <button onClick={onClose} aria-label="Close" className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] mb-2">Preview</p>
        <div className={cn("pointer-events-none", f.layout === "poster" ? "max-w-[460px]" : "")}>
          {preview.imageUrl || preview.heading
            ? <PromoPanel promo={preview} shape={f.layout === "poster" ? "poster" : "banner"} />
            : <p className="text-[12px] text-[color:var(--text-muted)]">Add an image or a heading to see the preview.</p>}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Internal title (admins only)"><input className={input} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} /></Field>
        <Field label="Button label (optional)"><input className={input} value={f.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={30} placeholder="e.g. Deposit now" /></Field>
        <Field label="Visible heading (text promotions)"><input className={input} value={f.heading} onChange={(e) => set("heading", e.target.value)} maxLength={80} /></Field>
        <Field label="Short description (optional)"><input className={input} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} /></Field>

        <Field label={`Desktop image${promo?.hasImage && !removeImage ? " (uploaded)" : ""}`}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="text-[12px] text-[color:var(--text-secondary)]"
            onChange={(e) => pick(setImage, e.target.files?.[0] ?? null)} />
          {promo?.hasImage && <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mt-1"><input type="checkbox" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} /> Remove current image</label>}
          <p className="text-[11px] text-[color:var(--text-muted)] mt-1">Banner ≈ 1600×400 (4:1), poster ≈ 1200×600 (2:1). Shown whole, never cropped. Max 4 MB.</p>
        </Field>
        <Field label={`Mobile image (optional)${promo?.hasMobileImage && !removeMobile ? " (uploaded)" : ""}`}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="text-[12px] text-[color:var(--text-secondary)]"
            onChange={(e) => pick(setMobile, e.target.files?.[0] ?? null)} />
          {promo?.hasMobileImage && <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)] mt-1"><input type="checkbox" checked={removeMobile} onChange={(e) => setRemoveMobile(e.target.checked)} /> Remove current mobile image</label>}
          <p className="text-[11px] text-[color:var(--text-muted)] mt-1">Used on phones. ≈ 800×400 (2:1).</p>
        </Field>
        <Field label="Image alternative text (required with an image)"><input className={input} value={f.imageAlt} onChange={(e) => set("imageAlt", e.target.value)} maxLength={200} placeholder="Describe the image" /></Field>

        <Field label="Destination">
          <div className="flex gap-2">
            <select className={cn(input, "w-auto")} value={f.destType} onChange={(e) => set("destType", e.target.value as DestType)}>
              {DEST_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            {f.destType === "internal" && (
              <select className={cn(input, "w-auto")} value="" onChange={(e) => e.target.value && set("destUrl", e.target.value)}>
                <option value="">Quick pick…</option>
                {QUICK_DESTINATIONS.map((d) => <option key={d.path} value={d.path}>{d.label}</option>)}
              </select>
            )}
          </div>
          <input className={cn(input, "mt-2", !destOk && "border-[color:var(--red)]")} value={f.destUrl} onChange={(e) => set("destUrl", e.target.value)}
            placeholder={f.destType === "internal" ? "/deposit" : "https://…"} />
          {!destOk && <p className="text-[11px] text-[color:var(--red)] mt-1">{f.destType === "internal" ? "Use a path on this site, starting with /" : "Use a full https:// address"}</p>}
        </Field>

        <Field label="Layout">
          <select className={input} value={f.layout} onChange={(e) => set("layout", e.target.value as PromoLayout)}>
            {PROMO_LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Placement">
          <select className={input} value={f.slot} onChange={(e) => set("slot", e.target.value as PromoSlot)}>
            {PROMO_SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Order within placement">
          <input type="number" min={0} max={999} className={input} value={f.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
        </Field>
        <Field label="Starts (optional)"><input type="datetime-local" className={input} value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
        <Field label="Ends (optional)"><input type="datetime-local" className={input} value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></Field>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Active
        </label>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] text-[color:var(--text-secondary)]">Cancel</button>
          <button onClick={save} disabled={saving} className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] disabled:opacity-50 flex items-center gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">{label}</label>
      {children}
    </div>
  );
}
