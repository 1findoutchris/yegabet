/*
 * Client-side helpers for running inside the Telegram Mini App (see
 * app/(user)/tg/page.tsx and components/telegram/TelegramBridge.tsx). In a
 * normal browser or the native app every helper here is a no-op and Telegram's
 * script is never loaded.
 *
 * Nothing here is trusted by the server. initData is passed through verbatim
 * for the server to validate; the parsed user Telegram exposes to JavaScript
 * (initDataUnsafe) is deliberately not read at all.
 */

/** The slice of window.Telegram.WebApp this app uses. */
export interface TgWebApp {
  initData: string;
  version: string;
  platform: string;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  requestContact?(cb?: (sent: boolean) => void): void;
  showScanQrPopup?(params: { text?: string }, cb?: (text: string) => boolean | void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { notificationOccurred(type: "error" | "success" | "warning"): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const SDK_URL = "https://telegram.org/js/telegram-web-app.js";
/** Set once the /tg page has seen real launch data; marks this tab as the
 *  Mini App for every page it navigates to afterwards. Session-scoped, so it
 *  ends with the Mini App. */
const FLAG_KEY = "vinna:tg";

/** The YegaBet navy, so Telegram's own chrome blends into the app's. */
export const TG_NAVY = "#0A0A0A";

function hashInitData(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData") ?? "";
  } catch {
    return "";
  }
}

/** Was this page opened by Telegram as a Mini App (now or earlier this session)? */
export function inTelegramContext(): boolean {
  if (typeof window === "undefined") return false;
  if (hashInitData()) return true;
  try {
    return sessionStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

const CHANGE_EVENT = "vinna:tg";

export function markTelegramSession(): void {
  try { sessionStorage.setItem(FLAG_KEY, "1"); } catch { /* storage blocked */ }
  document.documentElement.classList.add("tg-app");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore(subscribeTelegram, inTelegramContext, () => false). */
export function subscribeTelegram(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

let sdk: Promise<TgWebApp | null> | null = null;

/**
 * Load telegram-web-app.js once, and resolve with WebApp (or null when it
 * can't load — the caller falls back to the launch data in the URL hash).
 *
 * Must run before anything rewrites the URL: the script reads its launch
 * parameters from location.hash on load (and from sessionStorage after a
 * reload).
 */
export function loadTelegramSdk(): Promise<TgWebApp | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  sdk ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve(window.Telegram?.WebApp ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    // A blocked or hung script must not hang the app.
    setTimeout(() => resolve(window.Telegram?.WebApp ?? null), 8000);
  });
  return sdk;
}

/** The current WebApp, if the SDK has loaded. */
export function webApp(): TgWebApp | null {
  return typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;
}

/** Raw, still-unverified initData for the server to validate. */
export function rawInitData(): string {
  return webApp()?.initData || hashInitData();
}

export function atLeast(v: string): boolean {
  try { return !!webApp()?.isVersionAtLeast(v); } catch { return false; }
}

/**
 * Open a URL outside the Mini App. t.me links stay in Telegram; anything else
 * goes to the external browser — the safe route for pages (and game
 * providers) that won't run inside Telegram's WebView.
 */
export function openExternal(url: string): void {
  const app = webApp();
  if (!app) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  let host = "";
  try { host = new URL(url).hostname; } catch { /* relative or bad URL */ }
  if (host === "t.me") app.openTelegramLink(url);
  else app.openLink(url);
}
