"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, ExternalLink, Maximize2, RotateCw } from "lucide-react";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useBalance } from "@/contexts/BalanceContext";
import { LaunchOverlay } from "@/components/vinna/LaunchOverlay";
import { useInTelegram } from "@/hooks/useTelegram";
import { openExternal } from "@/lib/telegramWebApp";

/** How long a game may take to load before the player offers a reload. */
const SLOW_MS = 20_000;

type Phase =
  | { kind: "launching" }
  | { kind: "loading"; url: string }
  | { kind: "playing"; url: string }
  | { kind: "login" }
  | { kind: "external" }
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
  const inTelegram = useInTelegram();
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

  /**
   * Telegram only: play in the phone's browser instead. A provider whose page
   * refuses to be framed, or needs storage Telegram's WebView blocks, still
   * fires the iframe's load event — so this can't be detected, only offered.
   * Asks for a fresh launch URL (they're single-use) and drops the iframe so
   * the game isn't running twice. The wallet is unchanged: the provider calls
   * our wallet URL server-to-server either way.
   */
  async function playOutside() {
    try {
      const res = await fetch("/api/games/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_uid: gameID }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.game_launch_url) {
        setPhase({ kind: "error", message: data.error ?? "Please try again in a moment." });
        return;
      }
      openExternal(data.game_launch_url);
      setPhase({ kind: "external" });
    } catch {
      setPhase({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }

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
      <div className="flex items-center gap-2 h-12 px-2 sm:px-4 shrink-0 bg-[var(--v-bg-1)] border-b border-[color:var(--v-line)]">
        <button
          onClick={back}
          aria-label="Back"
          className="w-9 h-9 grid place-items-center rounded-full bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-white font-bold text-[14px] truncate">{title}</p>
          {providerName && (
            <p className="text-[color:var(--v-text-3)] text-[11px] font-semibold uppercase tracking-[0.08em] truncate">{providerName}</p>
          )}
        </div>
        {url && (
          <button
            onClick={launch}
            title="Reload game"
            aria-label="Reload game"
            className="w-9 h-9 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors"
          >
            <RotateCw className="w-[18px] h-[18px]" />
          </button>
        )}
        {url && inTelegram && (
          <button
            onClick={playOutside}
            title="Open in browser"
            aria-label="Open in browser"
            className="w-9 h-9 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors"
          >
            <ExternalLink className="w-[18px] h-[18px]" />
          </button>
        )}
        {url && canFullscreen && (
          <button
            onClick={fullscreen}
            title="Fullscreen"
            aria-label="Fullscreen"
            className="w-9 h-9 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors"
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
          <LaunchOverlay name={name} provider={providerName}>
            {slow && (
              <div className="flex flex-col items-center gap-3 mt-6 v-fade-up">
                <p className="text-[color:var(--v-text-3)] text-xs text-center max-w-xs">
                  This is taking longer than usual.
                </p>
                <div className="flex gap-2">
                  <PanelButton onClick={launch} primary>Reload</PanelButton>
                  {inTelegram && <PanelButton onClick={playOutside}>Open in browser</PanelButton>}
                  <PanelButton onClick={back}>Back to games</PanelButton>
                </div>
              </div>
            )}
          </LaunchOverlay>
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

        {shown.kind === "external" && (
          <Panel>
            <p className="text-[color:var(--text-primary)] font-semibold text-sm">{title} is open in your browser</p>
            <p className="text-[color:var(--text-muted)] text-xs text-center max-w-xs">
              Same YegaBet balance — your bets and wins land in this wallet.
            </p>
            <div className="flex gap-2">
              <PanelButton onClick={launch} primary>Play here instead</PanelButton>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 bg-[var(--v-bg-0)] v-fade-in">
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
        "v-btn h-10 text-[13px] " + (primary ? "v-btn-primary" : "v-btn-ghost")
      }
    >
      {children}
    </button>
  );
}
