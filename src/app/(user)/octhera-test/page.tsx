"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ExternalLink, Loader2, Play, RefreshCw, X } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";

/*
 * Hidden Octhera test page — Spribe Aviator only. Not linked anywhere; only
 * accounts in OCTHERA_TEST_USERS get past the API (everyone else sees "not
 * available"). Aviator plays against the tester's OCTHERA balance, funded in
 * the Octhera portal — VinnaBet balances are never touched. The webhook log
 * below shows each bet/win Octhera reports, to verify the round end to end.
 */

interface Status {
  username: string;
  balance: { balance: number; currency: string } | null;
  balanceError: string | null;
  events: {
    txnId: string; action: string; betAmount: string; winAmount: string; amount: string | null;
    balance: string; currency: string; gameName: string | null; createdAt: string;
  }[];
  catalog?: {
    switchOn: boolean; apiKeySet: boolean; gamesFromOcthera: number; gamesShown: number;
    loadedAt: string | null; lastError: string | null;
  };
}

export default function OctheraTestPage() {
  const { data: session, status: authStatus } = useSession();
  const { openLogin } = useAuthModal();
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [gameUrl, setGameUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/octhera/status").catch(() => null);
    if (!res) { setState("error"); return; }
    if (res.status === 404 || res.status === 401) { setState("denied"); return; }
    if (!res.ok) { setState("error"); return; }
    setStatus(await res.json());
    setState("ok");
  }, []);

  useEffect(() => {
    if (!session) return;
    let live = true;
    const tick = () => { if (live) refresh(); };
    tick();
    const t = setInterval(tick, 5000); // webhooks land asynchronously
    return () => { live = false; clearInterval(t); };
  }, [session, refresh]);

  async function launch(newTab: boolean) {
    setLaunching(true); setError("");
    // Open the tab synchronously so the popup blocker allows it; fill it after.
    const tab = newTab ? window.open("about:blank", "_blank") : null;
    const device = window.innerWidth < 768 ? "mobile" : "desktop";
    const res = await fetch("/api/octhera/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setLaunching(false);
    if (!res?.ok || !d.launchUrl) {
      tab?.close();
      setError(d.error ?? "Could not launch Aviator");
      return;
    }
    if (tab) tab.location.href = d.launchUrl;
    else setGameUrl(d.launchUrl);
    refresh();
  }

  if (authStatus === "loading") return null;
  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <p className="text-[13px] text-[color:var(--text-secondary)] mb-4">Log in to continue.</p>
        <button onClick={openLogin} className="px-6 py-3 rounded-xl bg-gold-grad text-[#09090B] font-bold text-sm">Log in</button>
      </div>
    );
  }
  if (state === "denied") {
    return <div className="p-8 text-center text-[13px] text-[color:var(--text-muted)]">This page is not available.</div>;
  }
  if (state === "loading") {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)]">Octhera test — Aviator</h1>
        <p className="text-[12px] text-[color:var(--text-secondary)]">
          Plays with your <b>Octhera</b> test balance (fund it in the Octhera portal: Players → <span className="font-mono">{status?.username}</span> → Deposit). Your VinnaBet balance is not used.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Octhera balance</p>
          <p className="text-[20px] font-bold text-[color:var(--gold)] tabular-nums">
            {status?.balance ? `${status.balance.balance.toFixed(2)} ${status.balance.currency}` : "—"}
          </p>
          {!status?.balance && !status?.balanceError && (
            <p className="text-[11px] text-[color:var(--text-muted)]">Not registered yet — press Play once, then deposit in the portal.</p>
          )}
          {status?.balanceError && <p className="text-[11px] text-[color:var(--red)]">{status.balanceError}</p>}
        </div>
        <button onClick={refresh} className="p-2 rounded-lg text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)]" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {status?.catalog && (
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)] text-[12px] space-y-1">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">All Octhera games on the site</p>
          {!status.catalog.switchOn ? (
            <p className="text-[color:var(--text-secondary)]">Off — set <span className="font-mono">OCTHERA_GAMES_PUBLIC=true</span> in Railway to turn it on.</p>
          ) : !status.catalog.apiKeySet ? (
            <p className="text-[color:var(--red)]"><span className="font-mono">OCTHERA_API_KEY</span> is not set in Railway.</p>
          ) : (
            <p className="text-[color:var(--text-primary)]">
              <b>{status.catalog.gamesFromOcthera}</b> games from Octhera, <b>{status.catalog.gamesShown}</b> shown on the site
              {status.catalog.loadedAt && <span className="text-[color:var(--text-muted)]"> · loaded {new Date(status.catalog.loadedAt).toLocaleTimeString()}</span>}
            </p>
          )}
          {status.catalog.switchOn && status.catalog.lastError && (
            <p className="text-[color:var(--red)]">Last load failed: {status.catalog.lastError}</p>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-[color:var(--red)]">{error}</p>}

      <div className="flex gap-2">
        <button onClick={() => launch(false)} disabled={launching}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--gold)] text-black text-[14px] font-bold disabled:opacity-40">
          {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Play Aviator
        </button>
        <button onClick={() => launch(true)} disabled={launching}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)] disabled:opacity-40">
          <ExternalLink className="w-4 h-4" /> New tab
        </button>
      </div>

      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)]">
        <p className="px-4 py-3 text-[12px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-primary)] border-b border-[color:var(--border-muted)]">
          Webhooks received
        </p>
        {status?.events.length ? (
          <div className="divide-y divide-[color:var(--border-muted)]">
            {status.events.map((e) => (
              <div key={`${e.txnId}:${e.action}`} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
                <span className="w-28 shrink-0 font-mono font-bold text-[color:var(--text-primary)]">{e.action}</span>
                <span className="flex-1 min-w-0 text-[color:var(--text-secondary)] truncate">
                  {Number(e.betAmount) > 0 && `bet ${Number(e.betAmount)} `}
                  {Number(e.winAmount) > 0 && `win ${Number(e.winAmount)} `}
                  {e.amount && `amount ${Number(e.amount)} `}
                  {e.gameName ? `· ${e.gameName}` : ""}
                </span>
                <span className="shrink-0 tabular-nums text-[color:var(--text-muted)]">bal {Number(e.balance).toFixed(2)}</span>
                <span className="shrink-0 text-[color:var(--text-muted)] hidden sm:inline">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-[12px] text-[color:var(--text-muted)]">No webhooks yet. Place a bet in Aviator — they appear here within a few seconds.</p>
        )}
      </div>

      {gameUrl && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col">
          <div className="h-11 shrink-0 flex items-center justify-between px-3 bg-[var(--bg-surface)] border-b border-[color:var(--border-muted)]">
            <span className="text-[13px] font-bold text-[color:var(--text-primary)]">Aviator (Octhera test)</span>
            <button onClick={() => { setGameUrl(null); refresh(); }} className="p-1.5 rounded-lg text-[color:var(--text-secondary)]">
              <X className="w-5 h-5" />
            </button>
          </div>
          <iframe src={gameUrl} className="flex-1 w-full border-0" allow="fullscreen; autoplay" title="Aviator" />
        </div>
      )}
    </div>
  );
}
