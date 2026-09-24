"use client";

import { useState, useEffect, useRef, forwardRef } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, X, Phone, Lock, User, Loader2, CheckCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";

/**
 * Signup attribution from the landing URL (`?ref=` / `?promo=`).
 *
 * The current URL wins so a freshly-opened link always overrides an older
 * stashed one; sessionStorage is the fallback for when the visitor has since
 * navigated away from the landing page. Guarded because sessionStorage throws
 * in some privacy modes, and losing attribution must never break signup.
 */
function storedParam(key: "ref" | "promo"): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get(key);
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(`signup:${key}`);
  } catch {
    return null;
  }
}

/**
 * The 9 digits after +251, from whatever the user typed or pasted.
 *
 * People habitually write the trunk 0 (0912…) and sometimes paste the full
 * country code. Both are stripped here rather than rejected: the old field just
 * truncated to 9 characters, so "0912345678" became "+251091234567", which
 * fails normalizePhone server-side.
 */
function toLocalDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("251")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}

/** Ethiopian mobiles are exactly 9 digits starting 7 or 9. */
function phoneComplete(stored: string): boolean {
  return /^[79]\d{8}$/.test(toLocalDigits(stored));
}

export function AuthModal() {
  const { open, tab, setTab, close } = useAuthModal();
  const router = useRouter();

  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Forgot-password lives inside the login tab: null = normal login,
  // "phone" = asking for the number, "telegram" = waiting on the bot,
  // "reset" = code + new password.
  const [fpStep, setFpStep] = useState<null | "phone" | "telegram" | "reset">(null);
  const [fpCode, setFpCode] = useState("");
  const [fpPassword, setFpPassword] = useState("");
  const [showFpPw, setShowFpPw] = useState(false);
  const [fpError, setFpError] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpDone, setFpDone] = useState(false);

  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regRef, setRegRef] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regSuccess, setRegSuccess] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  // "form" = details, "code" = typing an SMS code, "telegram" = confirming in
  // the bot. Which of the last two you get is the server's call, not the
  // client's — see the /api/auth/otp/send response.
  const [regStep, setRegStep] = useState<"form" | "code" | "telegram">("form");
  const [regCode, setRegCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  // The open Telegram verification, shared by signup and password reset — only
  // one of the two can be on screen at a time. A token here means the poll
  // below is running; clearing it stops the poll.
  const [tgUrl, setTgUrl] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgMode, setTgMode] = useState(false);

  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoginError("");
    setRegError("");
    setRegSuccess(false);
    setRegStep("form");
    setRegCode("");
    setFpStep(null);
    setFpError("");
    setFpDone(false);
    setTgToken("");
    setTgUrl("");
    setTgMode(false);
  }, [tab]);

  // Resend cooldown countdown (seconds).
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  // Stash link attribution the moment the page loads, not at submit time. Both
  // params live on the landing URL and are gone the instant the visitor
  // navigates — which they usually do before registering. That silently lost
  // referral credit before; for an admin promo link it would lose a prize
  // promised to one named person, with no error anywhere.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    try {
      for (const key of ["ref", "promo"] as const) {
        const value = params.get(key);
        if (value) sessionStorage.setItem(`signup:${key}`, value);
      }
    } catch { /* private mode — fall back to reading the URL at submit time */ }
  }, []);

  // Pre-fill referral code from URL when the modal first opens on the register tab
  useEffect(() => {
    if (open && tab === "register" && !regRef) {
      const urlRef = storedParam("ref");
      if (urlRef) setRegRef(urlRef.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 80);
  }, [open, tab]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [close]);

  // Wait for the bot to confirm the number. The code that comes back is never
  // shown or typed — it goes straight to the same register / reset endpoints the
  // SMS rail used, so only the delivery of it changed.
  //
  // Polling rather than a socket: the wait is a couple of taps long and this
  // costs one redis GET, where a socket would cost a connection per open signup
  // form. Network blips are swallowed and retried — the verification is already
  // done on the server, so giving up on one failed poll would strand it.
  useEffect(() => {
    // `open` is in the guard because the hooks above still run once the modal
    // is closed (the early return below is not a hook boundary) — without it a
    // closed modal keeps polling forever, and would eventually register someone
    // who walked away. Reopening resumes: the token is still in state.
    if (!tgToken || !open) return;
    let alive = true;

    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/telegram/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tgToken }),
        });
        const data = await res.json();
        if (!alive || !data?.code) return;

        setTgToken("");
        if (tab === "register") {
          doRegister(data.code);
        } else {
          setFpCode(data.code);
          setFpStep("reset");
        }
      } catch { /* keep polling */ }
    }, 2000);

    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgToken, tab, open]);

  if (!open) return null;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");

    const result = await signIn("credentials", {
      phone: loginPhone.trim(),
      password: loginPassword,
      redirect: false,
    });

    setLoginLoading(false);
    if (result?.error) {
      setLoginError("Incorrect phone number or password.");
    } else {
      close();
      router.refresh();
    }
  }

  // Step 1: validate, then open verification. Three answers are possible, and
  // the server picks: { skip } registers straight away (foreign number, or the
  // kill switch), { telegram } sends them to the bot, anything else is an SMS
  // code on its way.
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regName.trim().length < 2) { setRegError("Please enter your name."); return; }
    if (regPassword !== regConfirm) { setRegError("Passwords do not match."); return; }
    if (regPassword.length < 6) { setRegError("Password must be at least 6 characters."); return; }

    setRegLoading(true);
    setRegError("");

    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: regPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setRegError(data.error ?? "Could not send code."); setRegLoading(false); return; }

      if (data.skip) { await doRegister(); return; }

      if (data.telegram) {
        setRegLoading(false);
        setTgMode(true);
        setTgUrl(data.telegram.url);
        setTgToken(data.telegram.token);
        setRegStep("telegram");
        return;
      }

      // OTP sent — move to code entry.
      setRegLoading(false);
      setRegStep("code");
      setRegCode("");
      setResendIn(60);
    } catch {
      setRegError("Network error — please try again.");
      setRegLoading(false);
    }
  }

  // Step 2 (verified) / direct (nothing to verify): create the account and sign
  // in. The code is passed in rather than read from state because the Telegram
  // poll calls this the moment it has one, before a setState would land.
  async function doRegister(code?: string) {
    setRegLoading(true);
    setRegError("");

    try {
      // Typed code wins; otherwise fall back to whatever the landing URL carried.
      const refCode = regRef.trim().toUpperCase() || storedParam("ref") || undefined;
      // Admin rigged-link code — never typed, so URL/stash is the only source.
      const promoCode = storedParam("promo") || undefined;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName.trim(),
          phone: regPhone.trim(),
          password: regPassword,
          ...(refCode ? { referralCode: refCode } : {}),
          ...(promoCode ? { promoCode } : {}),
          ...(code ? { code } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) { setRegError(data.error ?? "Registration failed."); setRegLoading(false); return; }

      const result = await signIn("credentials", {
        phone: regPhone.trim(),
        password: regPassword,
        redirect: false,
      });

      setRegLoading(false);
      if (result?.error) { setRegSuccess(true); return; }

      close();
      if (promoCode) {
        // Signed up through an admin rigged link — send them straight to the
        // wheel, which is the whole point of the link. Deliberately not
        // conditional on the claim having succeeded: the register response
        // stays silent about that so the signup form can't be used to probe
        // which codes are still live. A spent code just lands them on the
        // wheel with their ordinary signup spins.
        // Cleared so a later signup on the same device doesn't re-trigger this.
        try { sessionStorage.removeItem("signup:promo"); } catch { /* private mode */ }
        router.push("/rewards/spin");
      } else {
        router.refresh();
      }
    } catch {
      setRegError("Network error — please try again.");
      setRegLoading(false);
    }
  }

  // Forgot step 1: send a reset code to a phone that must already have an account.
  async function handleForgotSend(e: React.FormEvent) {
    e.preventDefault();
    setFpLoading(true);
    setFpError("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone.trim(), purpose: "reset" }),
      });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error ?? "Could not send code."); setFpLoading(false); return; }
      setFpLoading(false);
      setFpCode("");
      setFpPassword("");

      if (data.telegram) {
        setTgMode(true);
        setTgUrl(data.telegram.url);
        setTgToken(data.telegram.token);
        setFpStep("telegram");
        return;
      }

      setFpStep("reset");
      setResendIn(60);
    } catch {
      setFpError("Network error — please try again.");
      setFpLoading(false);
    }
  }

  // Forgot step 2: code + new password, then sign straight in on success.
  async function handleForgotReset(e: React.FormEvent) {
    e.preventDefault();
    if (fpPassword.length < 6) { setFpError("Password must be at least 6 characters."); return; }
    setFpLoading(true);
    setFpError("");
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone.trim(), code: fpCode.trim(), password: fpPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error ?? "Could not reset password."); setFpLoading(false); return; }

      const result = await signIn("credentials", {
        phone: loginPhone.trim(),
        password: fpPassword,
        redirect: false,
      });
      setFpLoading(false);
      // Password did change; if the auto sign-in fails, send them to the form.
      if (result?.error) { setFpDone(true); }
      else { close(); router.refresh(); }
    } catch {
      setFpError("Network error — please try again.");
      setFpLoading(false);
    }
  }

  async function handleForgotResend() {
    if (resendIn > 0) return;
    setFpError("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone.trim(), purpose: "reset" }),
      });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error ?? "Could not resend code."); return; }
      setResendIn(60);
    } catch {
      setFpError("Network error — please try again.");
    }
  }

  async function handleResend() {
    if (resendIn > 0) return;
    setRegError("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: regPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setRegError(data.error ?? "Could not resend code."); return; }
      setResendIn(60);
    } catch {
      setRegError("Network error — please try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" onClick={close}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative z-10 w-full max-w-[360px] bg-[var(--bg-surface)] border border-[color:var(--border-accent)] rounded-2xl shadow-2xl animate-pop"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 28px 70px rgba(0,0,0,0.65), var(--glow-gold)" }}
      >
        {/* Close */}
        <button onClick={close} className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors">
          <X className="w-4 h-4" />
        </button>

        {/* Logo */}
        <div className="pt-8 pb-4 flex flex-col items-center gap-2">
          <span className="w-12 h-12 bg-gold-grad glow-gold rounded-full flex items-center justify-center font-display text-[#09090B] font-extrabold text-xl leading-none">
            V
          </span>
          <span className="font-display text-[color:var(--text-primary)] font-extrabold text-lg tracking-[-0.03em]">
            Vinna<span className="text-gold-grad">Bet</span>
          </span>
        </div>

        {/* Tab switcher */}
        <div className="mx-5 mb-4 flex bg-[var(--bg-base)] border border-[color:var(--border-muted)] rounded-xl p-1">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 h-9 rounded-lg text-sm font-semibold transition-all",
                tab === t ? "bg-gold-grad text-[#09090B]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
              )}
            >
              {t === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Login form (with the forgot-password sub-flow) */}
        {tab === "login" && fpStep === null && (
          <form onSubmit={handleLogin} className="px-5 pb-6 space-y-2.5">
            <PhoneField ref={firstRef} value={loginPhone} onChange={setLoginPhone} />
            <PwField placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} show={showLoginPw} onToggle={() => setShowLoginPw(v => !v)} />
            {loginError && <p className="text-[color:var(--red)] text-xs">{loginError}</p>}
            <SubmitBtn loading={loginLoading} disabled={!phoneComplete(loginPhone) || !loginPassword}>Log In</SubmitBtn>
            <div className="text-center pt-0.5">
              <button
                type="button"
                onClick={() => { setFpStep("phone"); setFpError(""); setLoginError(""); }}
                className="text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--gold)] font-medium"
              >
                Forgot password?
              </button>
            </div>
            <p className="text-center text-xs text-[color:var(--text-muted)] pt-0.5">
              No account?{" "}
              <button type="button" onClick={() => setTab("register")} className="text-[color:var(--gold)] hover:text-[color:var(--gold-hover)] font-semibold">Sign up free</button>
            </p>
          </form>
        )}

        {/* Forgot password */}
        {tab === "login" && fpStep !== null && (
          <form
            onSubmit={fpStep === "phone" ? handleForgotSend : handleForgotReset}
            className="px-5 pb-6 space-y-2.5"
          >
            {fpDone ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle className="w-10 h-10 text-[color:var(--green)]" />
                <p className="text-[color:var(--text-primary)] font-semibold">Password updated</p>
                <p className="text-[color:var(--text-secondary)] text-sm">Please log in with your new password.</p>
                <button
                  type="button"
                  onClick={() => { setFpStep(null); setFpDone(false); setLoginPassword(""); }}
                  className="shine glow-gold w-full h-10 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm transition-transform hover:scale-[1.02]"
                >
                  Log In
                </button>
              </div>
            ) : fpStep === "phone" ? (
              <>
                <p className="text-center text-[color:var(--text-secondary)] text-sm pb-1">
                  Enter your phone number to reset your password.
                </p>
                <PhoneField ref={firstRef} value={loginPhone} onChange={setLoginPhone} />
                {fpError && <p className="text-[color:var(--red)] text-xs">{fpError}</p>}
                <SubmitBtn loading={fpLoading} disabled={!phoneComplete(loginPhone)}>Continue</SubmitBtn>
                <div className="text-center pt-0.5">
                  <button type="button" onClick={() => { setFpStep(null); setFpError(""); }} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
                    ← Back to log in
                  </button>
                </div>
              </>
            ) : fpStep === "telegram" ? (
              <TgVerifyStep
                phone={loginPhone.trim()}
                url={tgUrl}
                waiting={!!tgToken}
                busyLabel="Confirmed! One moment…"
                error={fpError}
                backLabel="← Change number"
                onBack={() => { setTgToken(""); setFpStep("phone"); setFpError(""); }}
              />
            ) : (
              <>
                <p className="text-center text-[color:var(--text-secondary)] text-sm pb-1">
                  {tgMode ? "Number confirmed. Choose a new password for" : "Enter the 6-digit code sent to"}<br />
                  <span className="text-[color:var(--text-primary)] font-semibold">{loginPhone.trim()}</span>
                </p>
                {/* Telegram already proved the number and handed the page its
                    code — there is nothing left for the user to type. */}
                {!tgMode && (
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={fpCode}
                    onChange={(e) => setFpCode(e.target.value.replace(/\D/g, ""))}
                    className={cn(FIELD, "px-3 text-center font-mono text-lg tracking-[0.4em]")}
                  />
                )}
                <PwField
                  placeholder="New password (min 6 characters)"
                  value={fpPassword}
                  onChange={(e) => setFpPassword(e.target.value)}
                  show={showFpPw}
                  onToggle={() => setShowFpPw((v) => !v)}
                  autoComplete="new-password"
                />
                {fpError && <p className="text-[color:var(--red)] text-xs">{fpError}</p>}
                <SubmitBtn loading={fpLoading} disabled={fpCode.length !== 6 || fpPassword.length < 6}>
                  Reset Password
                </SubmitBtn>
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <button type="button" onClick={() => { setFpStep("phone"); setFpError(""); }} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
                    ← Change number
                  </button>
                  {!tgMode && (
                    <button
                      type="button"
                      onClick={handleForgotResend}
                      disabled={resendIn > 0}
                      className="text-[color:var(--gold)] hover:text-[color:var(--gold-hover)] font-semibold disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed"
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                    </button>
                  )}
                </div>
              </>
            )}
          </form>
        )}

        {/* Register form */}
        {tab === "register" && (
          <form
            onSubmit={regStep === "code" ? (e) => { e.preventDefault(); doRegister(regCode.trim()); } : handleRegister}
            className="px-5 pb-6 space-y-2.5"
          >
            {regSuccess ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle className="w-10 h-10 text-[color:var(--green)]" />
                <p className="text-[color:var(--text-primary)] font-semibold">Account created!</p>
                <p className="text-[color:var(--text-secondary)] text-sm">Your account is ready. Please log in to continue.</p>
                <button type="button" onClick={() => setTab("login")} className="shine glow-gold w-full h-10 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm transition-transform hover:scale-[1.02]">
                  Log In
                </button>
              </div>
            ) : regStep === "telegram" ? (
              <TgVerifyStep
                phone={regPhone.trim()}
                url={tgUrl}
                waiting={!!tgToken}
                busyLabel="Confirmed! Creating your account…"
                error={regError}
                backLabel="← Edit details"
                onBack={() => { setTgToken(""); setRegStep("form"); setRegError(""); }}
              />
            ) : regStep === "code" ? (
              <>
                <p className="text-center text-[color:var(--text-secondary)] text-sm pb-1">
                  Enter the 6-digit code sent to<br />
                  <span className="text-[color:var(--text-primary)] font-semibold">{regPhone.trim()}</span>
                </p>
                <input
                  ref={firstRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={regCode}
                  onChange={(e) => setRegCode(e.target.value.replace(/\D/g, ""))}
                  className={cn(FIELD, "px-3 text-center font-mono text-lg tracking-[0.4em]")}
                />
                {regError && <p className="text-[color:var(--red)] text-xs">{regError}</p>}
                <SubmitBtn loading={regLoading} disabled={regCode.length !== 6}>Verify &amp; Create Account</SubmitBtn>
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <button type="button" onClick={() => { setRegStep("form"); setRegError(""); }} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
                    ← Edit details
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendIn > 0}
                    className="text-[color:var(--gold)] hover:text-[color:var(--gold-hover)] font-semibold disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <NameField ref={firstRef} value={regName} onChange={(e) => setRegName(e.target.value)} />
                <PhoneField value={regPhone} onChange={setRegPhone} />
                <PwField placeholder="Password (min 6 characters)" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} show={showRegPw} onToggle={() => setShowRegPw(v => !v)} />
                <PwField placeholder="Confirm password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} show={showRegPw} onToggle={() => setShowRegPw(v => !v)} />
                <RefField value={regRef} onChange={(e) => setRegRef(e.target.value.toUpperCase())} />
                {regError && <p className="text-[color:var(--red)] text-xs">{regError}</p>}
                <SubmitBtn loading={regLoading} disabled={!regName || !phoneComplete(regPhone) || !regPassword || !regConfirm}>Create Account</SubmitBtn>
                <p className="text-center text-xs text-[color:var(--text-muted)] pt-0.5">
                  Already registered?{" "}
                  <button type="button" onClick={() => setTab("login")} className="text-[color:var(--gold)] hover:text-[color:var(--gold-hover)] font-semibold">Log in</button>
                </p>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

/**
 * The "go confirm in Telegram" screen, shared by signup and password reset.
 *
 * A real anchor rather than window.open: on a phone the t.me link has to reach
 * the Telegram app, and a popup opened from an async callback is exactly what
 * mobile browsers block.
 */
function TgVerifyStep({ phone, url, waiting, busyLabel, error, backLabel, onBack }: {
  phone: string;
  url: string;
  waiting: boolean;
  busyLabel: string;
  error: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <>
      <p className="text-center text-[color:var(--text-secondary)] text-sm pb-1">
        Confirm{" "}
        <span className="text-[color:var(--text-primary)] font-semibold">{phone}</span>{" "}
        on Telegram — tap <span className="text-[color:var(--text-primary)] font-semibold">Share my phone number</span> in the chat that opens.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shine glow-gold w-full h-11 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm transition-transform hover:scale-[1.02] flex items-center justify-center gap-2"
      >
        <Send className="w-4 h-4" />
        Open Telegram
      </a>
      {/* Nothing is in flight once something has failed — a spinner left
          turning under an error message reads as "still trying". */}
      {!error && (
        <div className="flex items-center justify-center gap-2 text-xs text-[color:var(--text-muted)] pt-0.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {waiting ? "Waiting for confirmation…" : busyLabel}
        </div>
      )}
      {error && <p className="text-[color:var(--red)] text-xs text-center">{error}</p>}
      <div className="text-center pt-0.5">
        <button type="button" onClick={onBack} className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]">
          {backLabel}
        </button>
      </div>
    </>
  );
}

const FIELD ="w-full h-10 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-sm placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors";

const NameField = forwardRef<HTMLInputElement, { value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }>(
  function NameField({ value, onChange }, ref) {
    return (
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
        <input
          ref={ref}
          type="text"
          placeholder="Full name"
          value={value}
          onChange={onChange}
          autoComplete="name"
          className={cn(FIELD, "pl-9 pr-3")}
        />
      </div>
    );
  }
);

// Fixed +251 (Ethiopia) prefix. The parent stores the full E.164 value
// (+251XXXXXXXXX); the input only shows/edits the 9-digit local part.
const PhoneField = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void }>(
  function PhoneField({ value, onChange }, ref) {
    const local = toLocalDigits(value);
    return (
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
        <span className="absolute left-8 top-1/2 -translate-y-1/2 text-sm text-[color:var(--text-secondary)] pointer-events-none">+251</span>
        <input
          ref={ref}
          type="tel"
          inputMode="numeric"
          maxLength={15}
          placeholder="9XXXXXXXX"
          value={local}
          onChange={(e) => onChange("+251" + toLocalDigits(e.target.value))}
          autoComplete="tel-national"
          className={cn(FIELD, "pl-[4.5rem] pr-3")}
        />
      </div>
    );
  }
);

function PwField({ placeholder, value, onChange, show, onToggle, autoComplete = "current-password" }: {
  placeholder: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  show: boolean;
  onToggle: () => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--text-muted)] pointer-events-none" />
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className={cn(FIELD, "pl-9 pr-10")}
      />
      <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] transition-colors">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function RefField({ value, onChange }: { value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }) {
  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Referral code (optional)"
        value={value}
        onChange={onChange}
        maxLength={6}
        autoComplete="off"
        className={cn(FIELD, "px-3 font-mono tracking-widest uppercase placeholder:normal-case placeholder:tracking-normal")}
      />
    </div>
  );
}

function SubmitBtn({ loading, disabled, children }: { loading: boolean; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="shine glow-gold w-full h-11 rounded-xl bg-gold-grad disabled:opacity-50 disabled:cursor-not-allowed text-[#09090B] font-bold text-sm transition-transform hover:scale-[1.02] flex items-center justify-center gap-2"
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
