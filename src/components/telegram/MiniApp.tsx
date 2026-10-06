"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { VMark } from "@/components/vinna/VMark";
import { VLoader } from "@/components/vinna/VLoader";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { startPath } from "@/lib/tgStartCore";
import {
  atLeast, loadTelegramSdk, markTelegramSession, openExternal, rawInitData, webApp,
} from "@/lib/telegramWebApp";

/*
 * The Telegram Mini App's front door (/tg). Not a screen of its own: it signs
 * the user in and then hands over to the normal VinnaBet site — the default
 * route (/casino, where / redirects) or a deep-link target — so the Mini App
 * looks and works exactly like vinna.bet.
 *
 *   Telegram → initData → POST /api/telegram/miniapp (validated server-side)
 *     linked   → signIn("telegram", { initData }) → normal VinnaBet session
 *     unlinked → "Connect your VinnaBet account" → share contact → poll → sign in
 *
 * Nothing about the user is decided here: the page only forwards the raw
 * initData Telegram gave it, and both the status check and the sign-in
 * validate it on the server with the bot token. After sign-in the Mini App is
 * simply the VinnaBet site — same pages, same API routes, same wallet.
 */

/** Where the website lands too: / redirects here (app/page.tsx). */
const DEFAULT_PATH = "/casino";

type Phase =
  | { kind: "boot" }
  | { kind: "browser" }
  | { kind: "signing-in" }
  | { kind: "connect"; waiting: boolean; error: string | null }
  | { kind: "stale" }
  | { kind: "error"; message: string };

type Status = {
  linked: boolean;
  linkError: string | null;
  firstName: string | null;
  startPath: string | null;
  botUsername: string | null;
};

const POLL_MS = 1500;
const POLL_FOR_MS = 60_000;

const LINK_ERRORS: Record<string, string> = {
  "no-account": "No VinnaBet account was found for this phone number.",
  "not-ethiopian": "This Telegram account's number isn't an Ethiopian mobile, so it can't match a VinnaBet account.",
  "not-own-contact": "That wasn't your own contact. Share this Telegram account's number.",
  "telegram-in-use": "This Telegram is already linked to another VinnaBet account. Send /unlink to the bot first.",
  "account-has-other-telegram": "That VinnaBet account is linked to a different Telegram account. Contact support to move it.",
  ambiguous: "This account can't be linked from Telegram. Please contact support.",
  unavailable: "This account can't be linked from Telegram. Please contact support.",
};

async function fetchStatus(initData: string, since?: number): Promise<Status | "stale" | null> {
  try {
    const res = await fetch("/api/telegram/miniapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(since === undefined ? { initData } : { initData, since }),
    });
    if (res.status === 401) return "stale";
    if (!res.ok) return null;
    return (await res.json()) as Status;
  } catch {
    return null;
  }
}

export function MiniApp({ botUsername }: { botUsername: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { openLogin, openRegister } = useAuthModal();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [firstName, setFirstName] = useState<string | null>(null);
  const [bot, setBot] = useState(botUsername);
  const started = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Where to land after sign-in: the signed startapp parameter first, then
  // ?to= from a bot button. Both go through the same allow-list.
  const toParam = params.get("to");

  const finish = useCallback(async (initData: string, target: string | null) => {
    setPhase({ kind: "signing-in" });
    const res = await signIn("telegram", { initData, redirect: false }).catch(() => null);
    if (!res || res.error) {
      setPhase({ kind: "stale" });
      return;
    }
    webApp()?.HapticFeedback?.notificationOccurred("success");
    router.replace(target && target !== "/tg" ? target : DEFAULT_PATH);
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      await loadTelegramSdk();
      const initData = rawInitData();
      if (!initData) {
        setPhase({ kind: "browser" });
        return;
      }
      markTelegramSession();

      const status = await fetchStatus(initData);
      if (status === "stale") return setPhase({ kind: "stale" });
      if (!status) return setPhase({ kind: "error", message: "Couldn't reach VinnaBet. Check your connection and try again." });

      setFirstName(status.firstName);
      if (status.botUsername) setBot(status.botUsername);
      const target = status.startPath ?? startPath(toParam);
      if (status.linked) await finish(initData, target);
      else setPhase({ kind: "connect", waiting: false, error: null });
    })();
  }, [finish, toParam]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  /** After the contact is shared, wait for the webhook to link it. */
  const poll = useCallback((since: number) => {
    const initData = rawInitData();
    const deadline = Date.now() + POLL_FOR_MS;
    const tick = async () => {
      const s = await fetchStatus(initData, since);
      if (s === "stale") return setPhase({ kind: "stale" });
      if (s?.linked) return finish(initData, startPath(toParam));
      if (s?.linkError) {
        webApp()?.HapticFeedback?.notificationOccurred("error");
        return setPhase({ kind: "connect", waiting: false, error: LINK_ERRORS[s.linkError] ?? LINK_ERRORS.unavailable });
      }
      if (Date.now() > deadline) {
        return setPhase({ kind: "connect", waiting: false, error: "We didn't receive your number. Try again, or check the VinnaBet chat." });
      }
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
  }, [finish, toParam]);

  function verifyPhone() {
    const app = webApp();
    const since = Date.now();
    setPhase({ kind: "connect", waiting: true, error: null });
    if (app?.requestContact && atLeast("6.9")) {
      // Telegram shows its own "share your number" dialog and, on yes, posts
      // the contact into the bot chat — where the webhook checks it's the
      // user's own and links the account.
      app.requestContact((sent) => {
        if (sent) poll(since);
        else setPhase({ kind: "connect", waiting: false, error: null });
      });
      return;
    }
    // Older clients: do it in the bot chat instead.
    if (bot) {
      openExternal(`https://t.me/${bot}?start=verify`);
      poll(since);
    } else {
      setPhase({ kind: "connect", waiting: false, error: "Open the VinnaBet bot and tap Verify Phone Number." });
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[150] overflow-y-auto bg-[var(--v-bg-0)] v-fade-in">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 max-w-sm mx-auto text-center"
        style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}>
        {(phase.kind === "boot" || phase.kind === "signing-in") && (
          <VLoader size={72} label={phase.kind === "signing-in" ? "Signing you in…" : "Opening VinnaBet…"} />
        )}

        {phase.kind === "connect" && (
          <>
            <VMark size={64} />
            <h1 className="mt-6 text-[24px] font-extrabold tracking-[-0.02em] text-white">Connect your VinnaBet Account</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--v-text-2)]">
              {firstName ? `Hi ${firstName}! ` : ""}Verify your phone number once and VinnaBet will sign you in
              automatically every time you open it from Telegram.
            </p>

            <button onClick={verifyPhone} disabled={phase.waiting} className="v-btn v-btn-primary h-12 w-full mt-7">
              {phase.waiting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              {phase.waiting ? "Waiting for Telegram…" : "Verify Phone via Telegram"}
            </button>
            {phase.waiting && (
              <p className="mt-3 text-[12px] text-[color:var(--v-text-3)]">Tap <b>Share</b> in the Telegram dialog.</p>
            )}
            {phase.error && <p className="mt-4 text-[13px] text-[color:var(--red)]">{phase.error}</p>}

            <p className="mt-6 flex items-center gap-1.5 text-[11px] text-[color:var(--v-text-3)]">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Only your Telegram number is shared — it must match your VinnaBet account.
            </p>

            <div className="mt-8 w-full grid grid-cols-2 gap-2">
              <button onClick={openRegister} className="v-btn v-btn-ghost h-11 text-[13px]">Create Account</button>
              <button onClick={openLogin} className="v-btn v-btn-ghost h-11 text-[13px]">Log in</button>
            </div>
            {sessionStatus === "authenticated" && session?.user && (
              <button onClick={() => router.replace(startPath(toParam) ?? DEFAULT_PATH)} className="mt-4 text-[13px] font-semibold text-[color:var(--v-teal)]">
                Continue as {session.user.name ?? session.user.username} →
              </button>
            )}
          </>
        )}

        {phase.kind === "browser" && (
          <>
            <VMark size={64} />
            <h1 className="mt-6 text-[22px] font-extrabold text-white">VinnaBet on Telegram</h1>
            <p className="mt-2 text-[14px] text-[color:var(--v-text-2)]">This page opens inside Telegram.</p>
            {bot && (
              <a href={`https://t.me/${bot}`} className="v-btn v-btn-primary h-12 w-full mt-7">Open in Telegram</a>
            )}
            <Link href="/casino" className="v-btn v-btn-ghost h-11 w-full mt-2 text-[13px]">Continue on the website</Link>
          </>
        )}

        {phase.kind === "stale" && (
          <>
            <VMark size={64} />
            <h1 className="mt-6 text-[20px] font-extrabold text-white">Please reopen VinnaBet</h1>
            <p className="mt-2 text-[14px] text-[color:var(--v-text-2)]">
              This session has expired. Close the app and open it again from the VinnaBet bot.
            </p>
            <button onClick={() => webApp()?.close()} className="v-btn v-btn-primary h-12 w-full mt-7">Close</button>
          </>
        )}

        {phase.kind === "error" && (
          <>
            <VMark size={64} />
            <p className="mt-6 text-[14px] text-[color:var(--v-text-2)]">{phase.message}</p>
            <button onClick={() => window.location.reload()} className="v-btn v-btn-primary h-12 w-full mt-6">Try again</button>
          </>
        )}
      </div>
    </div>
  );
}
