"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, X, RefreshCw } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { SPORTSBOOK_GAME_UID } from "@/types/games";

const BETBY_GAME_ID = SPORTSBOOK_GAME_UID;

type Status = "idle" | "loading" | "ready" | "auth" | "error";

export function SportsPane({ agentMode = false }: { agentMode?: boolean }) {
  const pathname  = usePathname();
  const isActive  = pathname.startsWith("/sports");
  const { data: session } = useSession();
  const { openLogin, openRegister } = useAuthModal();

  const [status,  setStatus]  = useState<Status>("idle");
  const [url,     setUrl]     = useState<string | null>(null);
  const [errMsg,  setErrMsg]  = useState("");

  const launch = useCallback(async () => {
    setStatus("loading");
    setUrl(null);
    try {
      const res = await fetch("/api/games/launch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ game_uid: BETBY_GAME_ID }),
      });

      if (res.status === 401) { setStatus("auth"); return; }

      const data = await res.json();
      if (data.game_launch_url) {
        setUrl(data.game_launch_url);
        setStatus("ready");
      } else {
        setStatus("error");
        setErrMsg(data.error ?? "Failed to load sportsbook");
      }
    } catch {
      setStatus("error");
      setErrMsg("Network error — please try again");
    }
  }, []);

  // Launch once on first visit to /sports
  useEffect(() => {
    if (isActive && status === "idle") launch();
  }, [isActive, status, launch]);

  // After login while sports tab is open, re-launch automatically
  useEffect(() => {
    if (isActive && status === "auth" && session) launch();
  }, [session, isActive, status, launch]);

  return (
    /*
     * Always in the DOM — shown/hidden via CSS so the iframe is NEVER unmounted.
     * display:none keeps the element alive (iframe state preserved) but off-screen.
     */
    <div
      className={
        isActive
          ? agentMode
            // Agent shell: mobile top bar (h-12), desktop sidebar (w-56), and
            // the ticket draft bar (~4rem) at the bottom.
            ? "fixed left-0 right-0 top-12 bottom-16 md:top-0 md:left-56 z-10 bg-[var(--bg-base)]"
            : "fixed left-0 right-0 top-14 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-10 bg-[var(--bg-base)]"
          : "hidden"
      }
    >
      {/* Loading */}
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-[color:var(--gold)] animate-spin" />
          <p className="text-[color:var(--text-secondary)] text-sm">Loading sportsbook…</p>
        </div>
      )}

      {/* Ready — iframe stays mounted */}
      {url && (
        <iframe
          src={url}
          className="w-full h-full border-0"
          allow="fullscreen"
          title="VinnaBet Sports"
          style={{ display: status === "ready" ? "block" : "none" }}
        />
      )}

      {/* Auth prompt */}
      {status === "auth" && (
        <div className="absolute inset-0 flex items-center justify-center px-4" style={{ background: "radial-gradient(700px 400px at 50% 0%, rgba(192,122,255,0.18), transparent 60%), var(--bg-base)" }}>
          <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[color:var(--border-accent)] rounded-2xl p-8 text-center animate-pop" style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6), var(--glow-gold)" }}>
            <div className="w-16 h-16 bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">⚽</span>
            </div>
            <h2 className="font-display text-[color:var(--text-primary)] text-xl font-bold mb-2">Bet on Sports</h2>
            <p className="text-[color:var(--text-secondary)] text-sm mb-6 leading-relaxed">
              Create a free account to access live odds, pre-match betting, and real-time scores.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={openRegister}
                className="shine glow-gold w-full h-11 bg-gold-grad text-[#09090B] font-bold rounded-xl text-sm transition-transform hover:scale-[1.02]"
              >
                Create Free Account
              </button>
              <button
                onClick={openLogin}
                className="w-full h-11 bg-[var(--bg-elevated)] hover:border-[color:var(--border-accent)] text-[color:var(--text-primary)] font-medium rounded-xl text-sm border border-[color:var(--border-base)] transition-colors"
              >
                Log In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4">
          <div className="w-12 h-12 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/30 flex items-center justify-center">
            <X className="w-5 h-5 text-[color:var(--red)]" />
          </div>
          <p className="text-[color:var(--text-secondary)] text-sm text-center">{errMsg}</p>
          <button
            onClick={launch}
            className="flex items-center gap-2 h-9 px-5 rounded-lg bg-gold-grad text-[#09090B] text-sm font-bold transition-transform hover:scale-[1.03]"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
