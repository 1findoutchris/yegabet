import { NextRequest, NextResponse } from "next/server";
import { requireOctheraTester } from "@/lib/octheraAccess";
import { OctheraError, aviatorGameUid, ensurePlayer, launchGame } from "@/lib/providers/octhera";

/**
 * POST { device?: "mobile" | "desktop" } — launch Spribe Aviator through
 * Octhera for the logged-in tester. Registers the player on first use.
 * Plays against the player's Octhera balance (funded in the Octhera portal).
 */
export async function POST(req: NextRequest) {
  const access = await requireOctheraTester();
  if (access instanceof NextResponse) return access;

  const body = await req.json().catch(() => ({}));
  const device = body?.device === "mobile" ? "mobile" : "desktop";

  try {
    await ensurePlayer(access.username);
    const gameUid = await aviatorGameUid();
    const launchUrl = await launchGame({ username: access.username, gameUid, device });
    return NextResponse.json({ launchUrl, username: access.username });
  } catch (e) {
    if (e instanceof OctheraError) {
      console.warn("[octhera/launch]", e.status, e.providerMessage);
      // Test page — show Octhera's own reason (e.g. "set lobbyUrl before launching games").
      return NextResponse.json({ error: `Octhera: ${e.providerMessage}` }, { status: 502 });
    }
    console.error("[octhera/launch]", e);
    return NextResponse.json({ error: "Could not reach Octhera" }, { status: 502 });
  }
}
