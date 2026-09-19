"use client";

import { useCallback, useEffect, useState } from "react";
import { Smartphone, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useAdminFetch } from "../useAdmin";
import { cn } from "@/lib/utils";

interface Device {
  label: string;
  kind: "smsgate" | "afro";
  user: string;
  url: string;
  enabled: boolean;
}

export default function OtpDevicesPage() {
  const adminFetch = useAdminFetch();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/otp-devices");
      if (!res.ok) throw new Error();
      setDevices((await res.json()).devices);
    } catch {
      setError("Failed to load devices.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(d: Device) {
    const next = !d.enabled;
    setBusy(d.label);
    setError("");
    // Optimistic, then rolled back on failure — a switch that lies about a
    // live handset is worse than a slow one.
    setDevices((prev) => prev.map((x) => (x.label === d.label ? { ...x, enabled: next } : x)));
    const res = await adminFetch("/otp-devices", {
      method: "PATCH",
      body: JSON.stringify({ label: d.label, enabled: next }),
    });
    if (!res.ok) {
      setDevices((prev) => prev.map((x) => (x.label === d.label ? { ...x, enabled: !next } : x)));
      setError("Could not change that device.");
    }
    setBusy(null);
  }

  const live = devices.filter((d) => d.enabled).length;

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-[color:var(--gold)]" />
          <h1 className="font-display text-[20px] font-extrabold text-[color:var(--text-primary)]">OTP Devices</h1>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[color:var(--border-base)] text-[12px] font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] disabled:opacity-50">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      <p className="text-[12px] text-[color:var(--text-muted)] mb-5">
        Gateways that send registration codes. Handsets are tried first in rotation; AfroMessage is a
        paid carrier and only runs once every enabled phone has failed. Switching one off takes effect
        on the next code — it stays configured, it just stops being used.
      </p>

      {error && (
        <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2 mb-4">{error}</p>
      )}

      {!loading && devices.length > 0 && live === 0 && (
        <p className="flex items-start gap-2 text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2 mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Every handset is off — no one can register or reset a password until you switch one back on.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[color:var(--gold)]" /></div>
      ) : devices.length === 0 ? (
        <p className="text-[13px] text-[color:var(--text-muted)] border border-[color:var(--border-base)] rounded-2xl p-6 text-center">
          No gateways configured. Add <code className="text-[color:var(--text-secondary)]">SMSGATE_USERNAME</code> /{" "}
          <code className="text-[color:var(--text-secondary)]">SMSGATE_PASSWORD</code> (and <code className="text-[color:var(--text-secondary)]">_2</code>…
          <code className="text-[color:var(--text-secondary)]">_5</code> for more handsets), or{" "}
          <code className="text-[color:var(--text-secondary)]">AFROMESSAGE_API_KEY</code>, to the environment.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <div key={d.label}
              className="flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">
                  {d.kind === "afro" ? "AfroMessage" : `Phone ${d.label}`}
                  {d.kind === "afro" && (
                    <span className="ml-2 text-[11px] font-medium text-[color:var(--text-muted)]">
                      paid · fallback
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-[color:var(--text-muted)] truncate">{d.user}</p>
              </div>
              <button
                onClick={() => toggle(d)}
                disabled={busy === d.label}
                className={cn(
                  "inline-flex items-center gap-2 px-3 h-9 rounded-xl text-[12px] font-semibold border transition-colors shrink-0 disabled:opacity-50",
                  d.enabled
                    ? "border-[#2BD97444] bg-[#2BD97412] text-[color:var(--green)]"
                    : "border-[#FF3B5C44] bg-[#FF3B5C12] text-[color:var(--red)]"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", d.enabled ? "bg-[var(--green)]" : "bg-[var(--red)]")} />
                {d.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
