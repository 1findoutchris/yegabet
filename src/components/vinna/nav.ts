/** Which top-level section a path belongs to — shared by header and bottom nav. */
export type Section = "home" | "sports" | "live" | "casino" | "games" | "rewards" | "account";

export function sectionFor(pathname: string): Section | null {
  // The Telegram Mini App's home screen.
  if (pathname === "/tg") return "home";
  if (pathname.startsWith("/sports")) return "sports";
  if (pathname.startsWith("/casino/live")) return "live";
  if (pathname.startsWith("/casino") || pathname.startsWith("/my-casino") || pathname.startsWith("/octhera")) return "casino";
  if (pathname.startsWith("/games") || pathname.startsWith("/game/")) return "games";
  if (pathname.startsWith("/rewards")) return "rewards";
  if (
    pathname.startsWith("/account") || pathname.startsWith("/deposit") || pathname.startsWith("/withdraw") ||
    pathname.startsWith("/tickets") || pathname.startsWith("/check")
  ) return "account";
  return null;
}
