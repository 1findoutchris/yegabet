"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRewardConfig } from "../../rewards/useRewardConfig";
import { FIELD, type WheelCfg } from "../shared";

/* Wheel settings tab. These three live in the reward config under key
   "spinWheel", not on the prize table — see ../page.tsx for the prizes. */

export default function SpinSettingsPage() {
  const { config, loading, error, adminFetch } = useRewardConfig();
  const [cfg, setCfg] = useState<WheelCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (config) setCfg(config.spinWheel as WheelCfg);
  }, [config]);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setErr("");
    const res = await adminFetch("/rewards", {
      method: "POST",
      body: JSON.stringify({ key: "spinWheel", value: cfg }),
    });
    setSaving(false);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? "Save failed."); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  const message = err || error;

  return (
    <div className="space-y-5">
      {message && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{message}</p>}

      {cfg && (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
          <h2 className="text-[15px] font-bold text-[color:var(--text-primary)] mb-3">Wheel settings</h2>
          <div className="grid sm:grid-cols-4 gap-3">
            <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)]">
              <input type="checkbox" checked={cfg.enabled}
                onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
              Wheel open
            </label>
            <div>
              <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">Spins on signup</label>
              <input type="number" min={0} max={20} className={FIELD} value={cfg.signupCredits}
                onChange={(e) => setCfg({ ...cfg, signupCredits: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">Spins per referral</label>
              <input type="number" min={0} className={FIELD} value={cfg.creditsPerReferral}
                onChange={(e) => setCfg({ ...cfg, creditsPerReferral: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">Max spins earned / week</label>
              <input type="number" min={0} className={FIELD} value={cfg.maxCreditsPerWeek}
                onChange={(e) => setCfg({ ...cfg, maxCreditsPerWeek: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={save} disabled={saving}
              className={cn("inline-flex items-center gap-2 px-4 h-9 rounded-xl text-[13px] font-bold",
                saved ? "bg-[var(--green)] text-[#09090B]" : "bg-gold-grad text-[#09090B]")}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" />
                : saved ? <><Check className="w-4 h-4" /> Saved</>
                : <><Save className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
