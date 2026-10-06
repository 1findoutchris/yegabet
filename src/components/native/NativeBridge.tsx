"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Download, RotateCw, WifiOff, X } from "lucide-react";
import { updateState, type AppVersionPolicy } from "@/lib/appVersion";
import { inAppPath } from "@/lib/deepLink";
import {
  NATIVE_BACK_EVENT,
  VinnaApp,
  hasNativePushToken,
  isNativeApp,
  nativePlatform,
  registerNativePush,
  unregisterNativePush,
} from "@/lib/native";

/**
 * Glue between the site and the native iOS/Android shell. Renders nothing in a
 * browser; in the app it wires the back button, deep links, push taps, the
 * offline screen, the update check and native printing. It never touches
 * betting, wallet or game logic: everything still goes through the same pages
 * and API routes as the website.
 */
export function NativeBridge() {
  // False on the server and in browsers; the native bridge is injected before
  // the page's scripts, so the first client render already knows.
  const native = useSyncExternalStore(noSubscribe, isNativeApp, () => false);
  return native ? <NativeShell /> : null;
}

const noSubscribe = () => () => {};

/** Tabs the back button leaves the app from instead of navigating. */
const ROOT_PATHS = new Set(["/", "/casino", "/dashboard"]);
const DISMISSED_UPDATE_KEY = "vinna:dismissedUpdate";

type Update = { state: "required" | "available"; version: string; storeUrl: string | null };

function NativeShell() {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();
  const [offline, setOffline] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);

  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  // One-time setup: platform classes, splash, printing.
  useEffect(() => {
    const platform = nativePlatform();
    const html = document.documentElement;
    html.classList.add("native-app", `native-${platform}`);

    import("@capacitor/splash-screen").then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {});

    // window.print() is a no-op in both WebViews. Fire the print events the
    // receipt listens for (PrintTicket), then hand the page to the native
    // print dialog, which renders it with the same print stylesheet.
    const webPrint = window.print;
    window.print = () => {
      window.dispatchEvent(new Event("beforeprint"));
      VinnaApp.print({ name: document.title })
        .catch(() => {})
        .finally(() => window.dispatchEvent(new Event("afterprint")));
    };
    return () => {
      window.print = webPrint;
      html.classList.remove("native-app", `native-${platform}`);
    };
  }, []);

  // Back button, deep links, push taps, resume.
  useEffect(() => {
    let disposed = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const keep = (h: { remove: () => Promise<void> }) => (disposed ? h.remove() : handles.push(h));

    const openLink = (url: string | undefined) => {
      const path = url && (url.startsWith("/") ? url : inAppPath(url));
      if (path) router.push(path);
    };

    (async () => {
      const { App } = await import("@capacitor/app");

      keep(await App.addListener("backButton", ({ canGoBack }) => {
        // 1. An open overlay that handles back (scanner, game, login…).
        const ev = new Event(NATIVE_BACK_EVENT, { cancelable: true });
        if (!window.dispatchEvent(ev)) return;
        // 2. Any other visible modal closes the way Escape closes it.
        const modal = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'))
          .find((el) => el.getClientRects().length > 0);
        if (modal) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return;
        }
        // 3. Page history, then home, then leave the app.
        if (canGoBack) window.history.back();
        else if (!ROOT_PATHS.has(pathRef.current)) router.replace("/casino");
        else App.exitApp();
      }));

      keep(await App.addListener("appUrlOpen", ({ url }) => openLink(url)));
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        // getLaunchUrl keeps returning the cold-start link; follow it once.
        try {
          if (sessionStorage.getItem("vinna:launchUrl") !== launch.url) {
            sessionStorage.setItem("vinna:launchUrl", launch.url);
            openLink(launch.url);
          }
        } catch {
          openLink(launch.url);
        }
      }

      // Coming back to the app: balances may have moved meanwhile.
      keep(await App.addListener("resume", () => window.dispatchEvent(new Event("vinna:activity"))));

      if (await VinnaApp.pushAvailable().then((r) => r.available).catch(() => false)) {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        keep(await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
          const url = (a.notification.data as { url?: string } | undefined)?.url;
          openLink(url ?? "/dashboard");
        }));
      }
    })().catch(() => {});

    return () => {
      disposed = true;
      handles.forEach((h) => h.remove());
    };
  }, [router]);

  // Push token follows the signed-in player: refreshed on sign-in (without
  // prompting), dropped on sign-out so the next person on the phone doesn't
  // get the previous player's alerts.
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status === "authenticated") registerNativePush(false).catch(() => {});
    else if (status === "unauthenticated" && was === "authenticated" && hasNativePushToken()) {
      unregisterNativePush().catch(() => {});
    }
  }, [status]);

  // Connection lost mid-session: cover the app instead of letting bets and
  // deposits fail one by one. (No connection at launch is native/www/offline.html.)
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    import("@capacitor/network").then(async ({ Network }) => {
      setOffline(!(await Network.getStatus()).connected);
      const h = await Network.addListener("networkStatusChange", (s) => setOffline(!s.connected));
      if (disposed) h.remove();
      else handle = h;
    }).catch(() => {});
    return () => {
      disposed = true;
      handle?.remove();
    };
  }, []);

  const wasOffline = useRef(false);
  useEffect(() => {
    if (wasOffline.current && !offline) router.refresh();
    wasOffline.current = offline;
  }, [offline, router]);

  // Store version check (lib/appVersion; configured with APP_* env vars).
  useEffect(() => {
    const platform = nativePlatform();
    if (!platform) return;
    (async () => {
      const { App } = await import("@capacitor/app");
      const [{ version }, res] = await Promise.all([
        App.getInfo(),
        fetch(`/api/app/version?platform=${platform}`),
      ]);
      if (!res.ok) return;
      const policy = (await res.json()) as AppVersionPolicy;
      const state = updateState(version, policy);
      if (state === "current") return;
      const target = state === "required" ? policy.minVersion! : policy.latestVersion!;
      try {
        if (state === "available" && localStorage.getItem(DISMISSED_UPDATE_KEY) === target) return;
      } catch { /* show it */ }
      setUpdate({ state, version: target, storeUrl: policy.storeUrl });
    })().catch(() => {});
  }, []);

  function dismissUpdate() {
    try { if (update) localStorage.setItem(DISMISSED_UPDATE_KEY, update.version); } catch {}
    setUpdate(null);
  }

  async function retryConnection() {
    const { Network } = await import("@capacitor/network");
    const s = await Network.getStatus();
    setOffline(!s.connected);
  }

  if (update?.state === "required") {
    return (
      <FullScreen>
        <Download className="w-9 h-9 text-[color:var(--v-teal)]" />
        <h2 className="text-[20px] font-extrabold text-white">Update VinnaBet</h2>
        <p className="text-[14px] text-[color:var(--v-text-2)] max-w-[300px]">
          This version of the app is no longer supported. Update to keep playing; your balance and bets are safe.
        </p>
        {update.storeUrl && (
          <a href={update.storeUrl} className="mt-2 px-7 py-3.5 rounded-2xl bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] font-bold text-[15px]">
            Update now
          </a>
        )}
      </FullScreen>
    );
  }

  return (
    <>
      {offline && (
        <FullScreen>
          <WifiOff className="w-9 h-9 text-[color:var(--v-teal)]" />
          <h2 className="text-[20px] font-extrabold text-white">You&apos;re offline</h2>
          <p className="text-[14px] text-[color:var(--v-text-2)] max-w-[300px]">
            Check your connection. Your balance and bets are safe; nothing is placed while you&apos;re offline.
          </p>
          <button onClick={retryConnection} className="mt-2 inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] font-bold text-[15px]">
            <RotateCw className="w-4 h-4" /> Try again
          </button>
        </FullScreen>
      )}
      {update?.state === "available" && !offline && (
        <div className="fixed left-3 right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 z-[900] flex items-center gap-3 rounded-2xl border border-[color:var(--v-line)] bg-[var(--v-bg-2)] p-3 shadow-2xl print:hidden">
          <Download className="w-5 h-5 shrink-0 text-[color:var(--v-teal)]" />
          <p className="flex-1 text-[13px] text-white">A new version of the app is available.</p>
          {update.storeUrl && (
            <a href={update.storeUrl} className="px-3 py-2 rounded-xl bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] text-[13px] font-bold">Update</a>
          )}
          <button onClick={dismissUpdate} aria-label="Dismiss" className="p-1 text-[color:var(--v-text-3)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 px-6 text-center bg-[var(--v-bg-1)] print:hidden" role="alertdialog" aria-live="assertive">
      {children}
    </div>
  );
}
