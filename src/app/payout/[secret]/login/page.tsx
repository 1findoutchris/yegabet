"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ArrowUpRight } from "lucide-react";

export default function PayoutLoginPage() {
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/payout/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-payout-secret": secret },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Login failed");
        return;
      }
      router.replace(`/payout/${secret}`);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-6">
        <div className="flex items-center gap-2 mb-1">
          <ArrowUpRight className="w-5 h-5 text-[color:var(--gold)]" />
          <p className="font-display text-[18px] font-extrabold text-[color:var(--text-primary)]">Payout Agent</p>
        </div>
        <p className="text-[12px] text-[color:var(--text-muted)] mb-5">Sign in with the credentials from your admin.</p>

        {error && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2 mb-4">{error}</p>}

        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Username</label>
        <input
          value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off"
          className="w-full h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)] mb-3"
        />
        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)] mb-5"
        />
        <button type="submit" disabled={busy || !username || !password}
          className="w-full h-11 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[14px] inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log in"}
        </button>
      </form>
    </div>
  );
}
