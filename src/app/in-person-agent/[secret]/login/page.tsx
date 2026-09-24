"use client";

import { useParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

/*
 * In-person agent login — /in-person-agent/<IN_PERSON_AGENT_SECRET>/login.
 *
 * Agents are ordinary users: this signs them in through the same NextAuth
 * credentials flow as the main site (same session, balance, deposits). The
 * URL secret is passed as `portalSecret`; authorize() only lets agents in
 * with it, and never lets agents in without it (see src/lib/auth.ts).
 */

// "9 digits after +251" from whatever was typed/pasted — same rule as AuthModal.
function toLocalDigits(v: string): string {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("251")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}

export default function AgentLoginPage() {
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();

  const [localPhone, setLocalPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Already signed in as an agent → straight to the sportsbook.
  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "IN_PERSON_AGENT") {
      router.replace("/sports");
    }
  }, [status, session, router]);

  async function handleLogin() {
    if (localPhone.length !== 9 || !password) {
      setError("Enter your phone number and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const phone = `+251${localPhone}`;
      const result = await signIn("credentials", { phone, password, portalSecret: secret, redirect: false });
      if (result?.error) {
        setError("Incorrect phone number or password.");
        setLoading(false);
        return;
      }
      router.replace("/sports");
    } catch {
      setError("Network error. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-3xl p-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-[#7DE8D8] via-[#2DD4BF] to-[#0D9488] flex items-center justify-center" style={{ width: 52, height: 52 }}>
            <span className="font-black text-[#09090B] text-[22px]">V</span>
          </div>
          <p className="font-extrabold text-[22px] text-[color:var(--text-primary)]">
            Vinna<span className="text-gold-grad">Bet</span>
          </p>
          <p className="text-[12px] text-[color:var(--text-muted)]">Betting agent portal</p>
        </div>

        {/* Phone */}
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] mb-1.5">
            Phone number
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-[color:var(--text-secondary)] pointer-events-none">
              +251
            </span>
            <input
              autoFocus
              type="tel"
              inputMode="numeric"
              value={localPhone}
              onChange={(e) => setLocalPhone(toLocalDigits(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="9XXXXXXXX"
              className="block w-full h-11 pl-14 pr-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[color:var(--text-primary)] text-sm outline-none focus:border-[color:var(--border-accent)]"
            />
          </div>
        </div>

        {/* Password */}
        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
              className="block w-full h-11 pl-3.5 pr-10 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[color:var(--text-primary)] text-sm outline-none focus:border-[color:var(--border-accent)]"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-[#FF3B5C18] border border-[#FF3B5C44] rounded-xl px-3.5 py-2.5 mb-3.5">
            <p className="text-[#FF3B5C] text-[13px]">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogin}
          disabled={loading || localPhone.length !== 9 || !password}
          className="w-full h-11.5 rounded-xl bg-gradient-to-br from-[#7DE8D8] via-[#2DD4BF] to-[#0D9488] text-[#09090B] font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ height: 46 }}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </div>
    </div>
  );
}
