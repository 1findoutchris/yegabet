"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronLeft, KeyRound, Loader2, Eye, EyeOff, Check } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";

export default function AccountSettingsPage() {
  const { data: session, status } = useSession();
  const { openLogin } = useAuthModal();

  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Checked here only to save a round trip — the server enforces the length,
  // and it can't check a confirmation field it never receives.
  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = current.length > 0 && password.length >= 6 && confirm === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setDone(false);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Could not change your password."); return; }
      setDone(true);
      setCurrent(""); setPassword(""); setConfirm("");
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] grid place-items-center mx-auto mb-4">
          <KeyRound className="w-6 h-6 text-[color:var(--gold)]" />
        </div>
        <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Settings</h1>
        <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 mb-5">Log in to manage your account.</p>
        <button onClick={openLogin} className="px-6 py-3 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm glow-gold hover:scale-[1.02] transition-transform">
          Log in
        </button>
      </div>
    );
  }

  const field =
    "w-full h-12 px-4 pr-11 rounded-2xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-24 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/account" className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">Settings</h1>
      </div>

      <form onSubmit={submit} className="rounded-3xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-[color:var(--gold)]" />
          <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">Change password</h2>
        </div>
        <p className="text-[12px] text-[color:var(--text-muted)] mb-5">
          You&apos;ll stay signed in on this device. At least 6 characters.
        </p>

        {error && (
          <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-3 py-2 mb-4">{error}</p>
        )}
        {done && (
          <p className="flex items-center gap-2 text-[13px] text-[color:var(--green)] bg-[#2BD97412] border border-[#2BD97433] rounded-xl px-3 py-2 mb-4">
            <Check className="w-4 h-4" /> Password changed.
          </p>
        )}

        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Current password</label>
        <div className="relative mb-4">
          <input type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password" className={field} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passwords" : "Show passwords"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">New password</label>
        <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" className={field + " mb-1"} />
        <p className="text-[11px] text-[color:var(--red)] h-4 mb-2">{tooShort ? "At least 6 characters." : ""}</p>

        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Confirm new password</label>
        <input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" className={field + " mb-1"} />
        <p className="text-[11px] text-[color:var(--red)] h-4 mb-3">{mismatch ? "Passwords don't match." : ""}</p>

        <button type="submit" disabled={busy || !ready}
          className="w-full h-12 rounded-2xl bg-gold-grad text-[#09090B] font-bold text-[14px] inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
        </button>

        {/* The SMS reset flow lives inside the login modal, which a signed-in
            player can't open — so this points at the way there, not a link. */}
        <p className="text-[12px] text-[color:var(--text-muted)] text-center mt-4">
          Forgotten it? Log out and use &ldquo;Forgot password&rdquo; on the login screen.
        </p>
      </form>
    </div>
  );
}
