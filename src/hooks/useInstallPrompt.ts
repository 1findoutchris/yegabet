"use client";

import { useCallback, useEffect, useState } from "react";

// Android/desktop Chrome fires this before showing its native install prompt;
// capturing it lets us trigger the prompt from our own button. iOS has no
// equivalent — there the only route is Share → Add to Home Screen.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Shared PWA install state. Two places offer the install — the top banner and
 * the profile dropdown — and both need the same `beforeinstallprompt` capture,
 * the same already-installed check and the same iOS carve-out. It lives here so
 * they cannot drift apart.
 *
 * `installed` starts true so nothing renders during SSR or the first paint;
 * the effect corrects it. Assuming the other way flashes an install offer at
 * people who already installed.
 *
 * The event is a window event, so every listener gets its own reference and
 * mounting this hook more than once is fine. Only the copy whose `install()`
 * is called consumes the prompt.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari exposes installed state here instead of display-mode.
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    if (standalone) return;

    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      setIsIOS(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  /** Opens the browser's install dialog. Resolves true if they went through with it. */
  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use — drop it either way so the button can't re-fire
    // a spent prompt.
    setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  return {
    /** A real one-tap install is available. False on iOS, which has no API. */
    canPrompt: !installed && deferred !== null,
    /** Installable, but only by hand through the Share sheet. */
    isIOS: !installed && isIOS,
    install,
  };
}
