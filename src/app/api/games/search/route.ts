import { NextRequest, NextResponse } from "next/server";
import { searchGames } from "@/lib/games";

/**
 * Game name search for the lobby field.
 *
 * Public, like the lobby it serves — the catalogue is already visible to anyone
 * browsing the site, so there is nothing here a session would protect. It reads
 * the in-memory catalogue and touches no database.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";

  // searchGames already refuses anything under 2 characters — a single letter
  // matches thousands of games and is nobody's actual query. Game is exactly
  // the six fields GameCard needs, so there is nothing to strip.
  return NextResponse.json({ games: searchGames(q) });
}
