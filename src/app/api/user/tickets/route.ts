import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUserTickets } from "@/lib/userTickets";

/**
 * GET — the logged-in player's own sportsbook bets as tickets, newest first.
 * `?search=` matches the bet code or a team/market name ("Find Ticket").
 * Same response shape as GET /api/agent/tickets, so both share TicketList.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  const tickets = await listUserTickets(session.user.id, search);
  return NextResponse.json({ tickets });
}
