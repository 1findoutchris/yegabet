import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Provider callback is always open
  if (pathname.startsWith("/api/provider")) return NextResponse.next();

  // Admin dashboard has its own auth (secret URL + Redis session cookie,
  // enforced client-side in the admin layout and server-side via
  // requireAdminAuth in /api/admin routes). Skip the NextAuth role gate.
  if (pathname.startsWith("/admin")) return NextResponse.next();

  // Cashier-agent dashboard has its own auth (agent session cookie, enforced in
  // the /agent layout and requireAgentAuth in /api/agent routes). Skip the
  // NextAuth role gate — these agents aren't players.
  if (pathname.startsWith("/agent")) return NextResponse.next();

  // Payout-agent portal — same deal: its own secret URL plus a payout session
  // cookie, enforced in the /payout layout and requirePayoutAuth in
  // /api/payout routes. These agents aren't players either.
  if (pathname.startsWith("/payout")) return NextResponse.next();

  if (pathname.startsWith("/affiliate") && session?.user?.role !== "AFFILIATE") {
    return session
      ? NextResponse.redirect(new URL("/dashboard", req.url))
      : NextResponse.redirect(new URL("/casino", req.url));
  }

  // Octhera's catalog is the site's catalog (lib/games). /octhera, the Lobby
  // URL in Octhera's portal, goes to the lobby, and crash games moved to the
  // Games section. Done here so it's a real 307, not a streamed one.
  if (process.env.GAME_CATALOG !== "legacy") {
    if (pathname === "/octhera") return NextResponse.redirect(new URL("/casino", req.url));
    if (pathname === "/casino/crash") return NextResponse.redirect(new URL("/games?tab=crash", req.url));
  }

  // All other routes (including /dashboard, /casino) are public
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
