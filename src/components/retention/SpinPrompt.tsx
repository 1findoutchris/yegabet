"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Sparkles } from "lucide-react";
import { useBalance } from "@/contexts/BalanceContext";

const SEEN_KEY = "spinPromptSeen";

/**
 * Nudges a player who still has unspent wheel coupons.
 *
 * Shown once per browsing session rather than on every navigation: the coupons
 * survive until they're used, so re-prompting on each page change would be
 * nagging rather than helpful. Dismissing hides it until the next visit; the
 * prompt stops for good once the coupons are spent.
 */
export function SpinPrompt() {
  const { spinCredits } = useBalance();
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (spinCredits <= 0) return;
    // Already on the wheel — nothing to prompt.
    if (pathname?.startsWith("/rewards/spin")) return;
    // Mid-game on the player page — don't cover the game.
    if (pathname?.startsWith("/game/")) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch { /* private mode — just show it */ }
    // Small delay so it doesn't fight the page's own entrance animation.
    const t = setTimeout(() => setShow(true), 900);
    return () => clearTimeout(t);
  }, [spinCredits, pathname]);

  function dismiss() {
    setShow(false);
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
  }

  if (!show || spinCredits <= 0) return null;

  return (
    <div
      className="fixed inset-0 z-[220] grid place-items-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-black/75 backdrop-blur-sm animate-pop"
      onClick={dismiss}
      role="dialog"
      aria-label="You have prize wheel spins"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[min(92vw,360px)] rounded-3xl border border-[color:var(--border-accent)] overflow-hidden text-center"
        style={{
          background: "linear-gradient(160deg,#1E1129 0%,#140C1E 55%,#0A1222 100%)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.7), var(--glow-gold)",
        }}
      >
        {/* Aurora bloom behind the wheel */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full"
          style={{ background: "radial-gradient(circle,rgba(25,211,197,0.22),transparent 65%)" }}
        />

        <button
          onClick={dismiss}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-9 h-9 grid place-items-center rounded-full text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative px-6 pt-8 pb-6">
          <MiniWheel />

          <p className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--gold)]">
            <Sparkles className="w-3.5 h-3.5" />
            {spinCredits} free {spinCredits === 1 ? "spin" : "spins"}
          </p>

          <h2 className="font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-[color:var(--text-primary)] mt-1.5">
            Your {spinCredits === 1 ? "spin is" : "spins are"} waiting
          </h2>
          <p className="text-[13px] leading-relaxed text-[color:var(--text-secondary)] mt-2">
            Take a turn on the prize wheel — cash prizes, free spins and the
            headline jackpots are all in play.
          </p>

          <Link
            href="/rewards/spin"
            onClick={dismiss}
            className="shine glow-gold mt-5 flex items-center justify-center w-full h-12 rounded-2xl bg-gold-grad text-[#09090B] font-extrabold text-[15px] tracking-[0.01em] active:scale-95 transition-transform"
          >
            Spin now
          </Link>

          <button
            onClick={dismiss}
            className="mt-3 text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)] transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

/** Decorative wheel. Purely presentational — the real one lives on /rewards/spin. */
function MiniWheel() {
  const uid = useId();
  const C = 50;
  const R = 40;
  const WEDGES = 8;

  return (
    <svg viewBox="0 0 100 100" className="w-[128px] h-[128px] mx-auto" aria-hidden>
      <defs>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--gold-2)" />
          <stop offset="50%" stopColor="var(--gold)" />
          <stop offset="100%" stopColor="var(--gold-deep)" />
        </linearGradient>
        <radialGradient id={`${uid}-hub`}>
          <stop offset="0%" stopColor="var(--gold-2)" />
          <stop offset="100%" stopColor="var(--gold-deep)" />
        </radialGradient>
      </defs>

      {/* The wheel turns slowly; the pointer below stays put. `spin-slow` is
          inside the reduced-motion guard in globals.css. */}
      <g className="spin-slow" style={{ transformOrigin: "50px 50px" }}>
        {Array.from({ length: WEDGES }, (_, i) => {
          const a0 = ((i * 360) / WEDGES - 90) * (Math.PI / 180);
          const a1 = (((i + 1) * 360) / WEDGES - 90) * (Math.PI / 180);
          return (
            <path
              key={i}
              d={`M ${C} ${C} L ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`}
              fill={i % 2 ? "var(--purple-deep)" : "#241436"}
              stroke="var(--gold-deep)"
              strokeWidth="0.6"
            />
          );
        })}
        <circle cx={C} cy={C} r={R} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="5" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 360) / 12 - 90) * (Math.PI / 180);
          return (
            <circle
              key={i}
              cx={C + (R + 0.2) * Math.cos(a)}
              cy={C + (R + 0.2) * Math.sin(a)}
              r="1.6"
              fill="#FFF6DA"
              className="animate-pulse-dot"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          );
        })}
      </g>

      <circle cx={C} cy={C} r="9" fill={`url(#${uid}-hub)`} stroke="var(--gold-deep)" strokeWidth="1" />
      <path d={`M ${C} ${C - R + 4} L ${C - 4.5} ${C - R - 7} L ${C + 4.5} ${C - R - 7} Z`}
        fill="var(--gold-2)" stroke="var(--gold-deep)" strokeWidth="0.8" />
    </svg>
  );
}
