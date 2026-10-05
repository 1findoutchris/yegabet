"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, Maximize2, RotateCw } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useBalance } from "@/contexts/BalanceContext";

/** How long a game may take to load before the player offers a reload. */
const SLOW_MS = 20_000;

type Phase =
  | { kind: "launching" }
  | { kind: "loading"; url: string }
  | { kind: "playing"; url: string }
  | { kind: "login" }
  | { kind: "error"; message: string };

/**
 * An Octhera game inside the site: the site header stays on top, this bar
 * (back, name, reload, fullscreen) sits under it, and the game's iframe fills
 * the rest of the screen. The launch URL comes from /api/games/launch (made on
 * the server, single-use), so every open or reload asks for a fresh one.
 *
 * If Octhera's game page refuses to be framed (X-Frame-Options or CSP
 * frame-ancestors), the browser shows its own error inside the iframe and the
 * page can't tell; the reload and back buttons stay usable either way, and a
 * game that never loads gets the "taking longer than usual" panel.
 */
export function OctheraPlayer({
  gameID,
  name,
  providerName,
}: {
  gameID: string;
  /** null when the id isn't in the catalog; the launch then says why. */
  name: string | null;
  providerName: string | null;
}) {
  const router = useRouter();
  const title = name ?? "Game";
  const label = name ?? "this game";
  const { status: authStatus } = useSession();
  const { openLogin } = useAuthModal();
  const { refresh } = useBalance();
  const frameBoxRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "launching" });
  const [slow, setSlow] = useState(false);
  // Element fullscreen isn't available on iPhone Safari; the button hides there.
  const canFullscreen = useSyncExternalStore(
    noSubscribe,
    () => !!document.fullscreenEnabled,
    () => false
  );
  // One launch per open: the URL is single-use, and dev Strict Mode runs
  // effects twice.
  const launchedFor = useRef<string | null>(null);

  const launch = useCallback(async () => {
    setPhase({ kind: "launching" });
    setSlow(false);
    try {
      const res = await fetch("/api/games/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_uid: gameID }),
      });
      if (res.status === 401) {
        setPhase({ kind: "login" });
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.game_launch_url) {
        setPhase({
          kind: "error",
          message: data.unavailable
            ? "This game can't be opened right now. Please try another."
            : (data.error ?? "Please try again in a moment."),
        });
        return;
      }
      setPhase({ kind: "loading", url: data.game_launch_url });
    } catch {
      setPhase({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }, [gameID]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      launchedFor.current = null;
      return;
    }
    if (launchedFor.current === gameID) return;
    launchedFor.current = gameID;
    launch();
  }, [authStatus, gameID, launch]);

  // A game that hasn't finished loading after a while: offer a reload.
  useEffect(() => {
    if (phase.kind !== "loading") return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Leaving the game: re-check points/streak and nudge the engagement watcher,
  // as closing the overlay player does.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    return () => {
      refreshRef.current();
      window.dispatchEvent(new Event("vinna:activity"));
    };
  }, []);

  function back() {
    if (window.history.length > 1) router.back();
    else router.push("/casino");
  }

  function fullscreen() {
    frameBoxRef.current?.requestFullscreen?.().catch(() => {});
  }

  // Logged out (or logged out mid-game): ask to log in; logging in launches.
  const shown: Phase = authStatus === "unauthenticated" ? { kind: "login" } : phase;
  const url = shown.kind === "loading" || shown.kind === "playing" ? shown.url : null;

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col bg-black">
      <div className="flex items-center gap-2 h-11 px-2 sm:px-4 shrink-0 bg-[#0C2027]/95 border-b border-[color:var(--border-muted)]">
        <button
          onClick={back}
          className="flex items-center gap-1 h-9 pl-1.5 pr-2.5 rounded-lg text-[13px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
          <span className="text-[color:var(--text-primary)] font-semibold text-sm truncate">{title}</span>
          {providerName && (
            <span className="hidden sm:inline text-[color:var(--text-muted)] text-xs shrink-0">· {providerName}</span>
          )}
        </div>
        {url && (
          <button
            onClick={launch}
            title="Reload game"
            aria-label="Reload game"
            className="p-2 rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <RotateCw className="w-[18px] h-[18px]" />
          </button>
        )}
        {url && canFullscreen && (
          <button
            onClick={fullscreen}
            title="Fullscreen"
            aria-label="Fullscreen"
            className="p-2 rounded-lg text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <Maximize2 className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>

      <div ref={frameBoxRef} className="relative flex-1 min-h-0 bg-black pb-[env(safe-area-inset-bottom)]">
        {url && (
          <iframe
            key={url}
            src={url}
            title={title}
            className="absolute inset-0 w-full h-full border-0 block"
            allow="fullscreen; autoplay; encrypted-media; clipboard-write"
            allowFullScreen
            onLoad={() => setPhase((p) => (p.kind === "loading" ? { kind: "playing", url: p.url } : p))}
          />
        )}

        {(shown.kind === "launching" || shown.kind === "loading") && (
          <Panel>
            <Loader2 className="w-9 h-9 text-[color:var(--gold)] animate-spin" />
            <p className="text-[color:var(--text-secondary)] text-sm">Loading {label}…</p>
            {slow && (
              <div className="flex flex-col items-center gap-3 mt-2">
                <p className="text-[color:var(--text-muted)] text-xs text-center max-w-xs">
                  This is taking longer than usual.
                </p>
                <div className="flex gap-2">
                  <PanelButton onClick={launch} primary>Reload</PanelButton>
                  <PanelButton onClick={back}>Back to games</PanelButton>
                </div>
              </div>
            )}
          </Panel>
        )}

        {shown.kind === "login" && (
          <Panel>
            <p className="text-[color:var(--text-primary)] font-semibold text-sm">Log in to play {label}</p>
            <div className="flex gap-2">
              <PanelButton onClick={openLogin} primary>Log in</PanelButton>
              <PanelButton onClick={back}>Back to games</PanelButton>
            </div>
          </Panel>
        )}

        {shown.kind === "error" && (
          <Panel>
            <p className="text-[color:var(--text-primary)] font-semibold text-sm">Couldn&apos;t open {label}</p>
            <p className="text-[color:var(--text-muted)] text-xs text-center max-w-xs">{shown.message}</p>
            <div className="flex gap-2">
              <PanelButton onClick={launch} primary>Try again</PanelButton>
              <PanelButton onClick={back}>Back to games</PanelButton>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 bg-[var(--bg-base)]">
      {children}
    </div>
  );
}

function PanelButton({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors " +
        (primary
          ? "bg-[var(--gold)] text-black hover:brightness-110"
          : "bg-[var(--bg-elevated)] text-[color:var(--text-primary)] hover:bg-[var(--bg-surface)]")
      }
    >
      {children}
    </button>
  );
}
