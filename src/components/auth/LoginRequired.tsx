"use client";

import { Lock } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";

/**
 * Full-page "log in first" gate for the personal sections (My Casino, Rewards).
 *
 * A client component because signing in happens in AuthModal, not on a route —
 * there is no /login to redirect a server component to. Same shape as the
 * logged-out state on the account page.
 */
export function LoginRequired({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const { openLogin, openRegister } = useAuthModal();

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] grid place-items-center mx-auto mb-4">
        <Lock className="w-6 h-6 text-[color:var(--gold)]" />
      </div>
      <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">{title}</h1>
      <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 mb-5">{message}</p>
      <div className="flex flex-col gap-2.5">
        <button
          onClick={openLogin}
          className="w-full h-11 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm glow-gold hover:scale-[1.02] transition-transform"
        >
          Log in
        </button>
        <button
          onClick={openRegister}
          className="w-full h-11 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-semibold text-sm hover:border-[color:var(--border-accent)] transition-colors"
        >
          Create an account
        </button>
      </div>
    </div>
  );
}
