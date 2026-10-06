"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useInTelegram } from "@/hooks/useTelegram";
import { TG_NAVY, atLeast, loadTelegramSdk, openExternal, webApp } from "@/lib/telegramWebApp";

/**
 * Glue between the site and the Telegram Mini App — the Telegram counterpart
 * of NativeBridge. Renders nothing; outside Telegram it does nothing at all
 * (Telegram's script is never even loaded).
 *
 * Inside Telegram the site is the same site: same pages, same API routes, same
 * session cookie. This only fits it to the WebView — Telegram's header and
 * background in VinnaBet navy, the native back button, no swipe-to-close
 * while scrolling a game, and external links routed through Telegram.
 */
export function TelegramBridge() {
  const inTg = useInTelegram();
  return inTg ? <TelegramShell /> : null;
}

/** Top-level screens: the back button is hidden on these. */
const ROOTS = new Set(["/tg", "/sports", "/casino", "/casino/live", "/games", "/account"]);

function TelegramShell() {
  const router = useRouter();
  const pathname = usePathname();
  const [sdkReady, setSdkReady] = useState(false);

  // One-time setup once the SDK is there.
  useEffect(() => {
    document.documentElement.classList.add("tg-app");
    let cancelled = false;
    loadTelegramSdk().then((app) => {
      if (cancelled || !app) return;
      app.ready();
      app.expand();
      if (atLeast("6.1")) {
        app.setHeaderColor(TG_NAVY);
        app.setBackgroundColor(TG_NAVY);
      }
      if (atLeast("7.10")) app.setBottomBarColor?.(TG_NAVY);
      // Without this, scrolling down inside a game or a long list can drag
      // the whole Mini App closed.
      if (atLeast("7.7")) app.disableVerticalSwipes?.();
      setSdkReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Telegram's back button mirrors in-app history. Re-runs once the SDK has
  // loaded, so the first screen gets it too.
  useEffect(() => {
    const app = webApp();
    if (!sdkReady || !app || !atLeast("6.1")) return;
    if (ROOTS.has(pathname)) {
      app.BackButton.hide();
      return;
    }
    const back = () => (window.history.length > 1 ? router.back() : router.push("/tg"));
    app.BackButton.onClick(back);
    app.BackButton.show();
    return () => app.BackButton.offClick(back);
  }, [pathname, router, sdkReady]);

  // A target=_blank or off-site link does nothing useful in the WebView
  // (Android drops window.open; iOS replaces the Mini App). Route it through
  // Telegram instead: t.me in Telegram, everything else in the browser.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      if (url.origin === window.location.origin) return;
      e.preventDefault();
      openExternal(url.toString());
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
