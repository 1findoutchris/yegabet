"use client";

import { Ticket } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";

/* Logged-out state for the player ticket pages — same pattern as /withdrawals. */
export function TicketsLoginPrompt() {
  const { openLogin } = useAuthModal();
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] grid place-items-center mx-auto mb-4">
        <Ticket className="w-6 h-6 text-[color:var(--gold)]" />
      </div>
      <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Ticket history</h1>
      <p className="text-[13px] text-[color:var(--text-secondary)] mt-1 mb-5">Log in to see and find your sports tickets.</p>
      <button onClick={openLogin} className="px-6 py-3 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm glow-gold hover:scale-[1.02] transition-transform">
        Log in
      </button>
    </div>
  );
}
