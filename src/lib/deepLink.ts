/**
 * The in-app path for a link that opened the native app, or null when the
 * link isn't ours. Handles universal/App Links (https://vinna.bet/tickets/X)
 * and the custom scheme (vinnabet://tickets/X).
 */
export function inAppPath(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }

  if (u.protocol === "vinnabet:") {
    // vinnabet://tickets/X parses with host "tickets" and path "/X".
    const path = [u.host, u.pathname.replace(/^\/+/, "")].filter(Boolean).join("/");
    return `/${path}${u.search}${u.hash}`;
  }

  if (u.protocol === "https:" && (u.hostname === "vinna.bet" || u.hostname.endsWith(".vinna.bet"))) {
    return `${u.pathname}${u.search}${u.hash}`;
  }

  return null;
}
