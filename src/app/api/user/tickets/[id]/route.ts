import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTicket } from "@/lib/userTickets";

/**
 * GET — one of the logged-in player's own sportsbook bets, in the same shape
 * as GET /api/agent/tickets/[id]. Someone else's bet id is a 404 — the lookup
 * is scoped to the session's user, never to an id from the request.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const ticket = await getUserTicket(session.user.id, id);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
