import { Capacitor, registerPlugin } from "@capacitor/core";

/*
 * Client-side helpers for the native iOS/Android apps (Capacitor shell that
 * loads this site; see capacitor.config.ts). In a normal browser every helper
 * here is a no-op: isNativeApp() is false and nothing native is imported.
 */

export type NativePlatform = "ios" | "android";

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function nativePlatform(): NativePlatform | null {
  if (!isNativeApp()) return null;
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

/** The app's own plugin (ios/App/App/VinnaNative.swift, android/…/VinnaAppPlugin.java). */
interface VinnaAppPlugin {
  print(options: { name?: string }): Promise<void>;
  pushAvailable(): Promise<{ available: boolean }>;
}
export const VinnaApp = registerPlugin<VinnaAppPlugin>("VinnaApp");

/**
 * Fired on window when the Android back button is pressed. An open overlay
 * that handles it calls preventDefault() so the page doesn't navigate too.
 */
export const NATIVE_BACK_EVENT = "vinna:native-back";

// ── Push ───────────────────────────────────────────────────────────────────

const TOKEN_KEY = "vinna:nativePushToken";
const OPT_OUT_KEY = "vinna:nativePushOff";

function optedOut(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) === "1"; } catch { return false; }
}
function setOptedOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch { /* storage blocked */ }
}

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked — the token is re-fetched next launch */ }
}

async function pushAvailable(): Promise<boolean> {
  try { return (await VinnaApp.pushAvailable()).available; } catch { return false; }
}

/** Whether this build can do push at all (Android needs google-services.json). */
export async function nativePushSupported(): Promise<boolean> {
  return isNativeApp() && (await pushAvailable());
}

async function fetchToken(): Promise<string> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const handles: { remove: () => Promise<void> }[] = [];
  const token = new Promise<string>((resolve, reject) => {
    PushNotifications.addListener("registration", (t) => resolve(t.value)).then((h) => handles.push(h));
    PushNotifications.addListener("registrationError", (e) => reject(new Error(e.error))).then((h) => handles.push(h));
  });
  try {
    await PushNotifications.register();
    return await token;
  } finally {
    handles.forEach((h) => h.remove());
  }
}

/**
 * Register this device for the signed-in player's notifications. With
 * `prompt` false it only refreshes an already-allowed registration (on launch
 * and after sign-in), never showing the OS permission dialog, and respects
 * the player having switched notifications off in the app.
 */
export async function registerNativePush(prompt: boolean): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform || !(await pushAvailable())) return false;
  if (!prompt && optedOut()) return false;
  const { PushNotifications } = await import("@capacitor/push-notifications");

  let { receive } = await PushNotifications.checkPermissions();
  if (receive !== "granted") {
    if (!prompt) return false;
    ({ receive } = await PushNotifications.requestPermissions());
    if (receive !== "granted") return false;
  }

  const token = await fetchToken();
  const res = await fetch("/api/user/push/native", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  if (!res.ok) return false;
  writeToken(token);
  setOptedOut(false);
  return true;
}

/**
 * Stop this device's notifications. `switchedOff` is the player turning them
 * off in the app (remembered); without it (sign-out) the next sign-in turns
 * them back on.
 */
export async function unregisterNativePush(switchedOff = false): Promise<void> {
  if (switchedOff) setOptedOut(true);
  const token = readToken();
  writeToken(null);
  if (token) {
    await fetch("/api/user/push/native", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }
  if (isNativeApp() && (await pushAvailable())) {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister().catch(() => {});
  }
}

export function hasNativePushToken(): boolean {
  return !!readToken();
}
