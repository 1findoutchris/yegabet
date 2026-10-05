import { NextResponse } from "next/server";
import { getHotGames, getProviderStats, catalogMode, loadGames } from "@/lib/games";

/**
 * What the search overlay shows before anything is typed: a few of the lobby's
 * popular games, and the casino providers so a query can match one by name.
 * Public and read-only, like /api/games/search — the in-memory catalogue, no
 * database.
 */
export async function GET() {
  await loadGames();
  const providers = getProviderStats(catalogMode() === "octhera" ? "casino" : undefined)
    .slice(0, 200)
    .map(({ slug, name, count }) => ({ slug, name, count }));
  return NextResponse.json({ games: getHotGames(12), providers });
}
