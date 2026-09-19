import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";

/**
 * POST — void an OPEN draft (customer walked away before the bet was placed).
 * Only empty drafts can be cancelled — once a bet is attached the money is
 * already moving and the ticket must run its course.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const { id } = await params;
  const ticket = await prisma.ticket.findFirst({
    where: { id, agentId: auth.userId },
    include: { bets: { select: { id: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (ticket.status !== "OPEN") {
    return NextResponse.json({ error: "Only an open draft can be cancelled" }, { status: 409 });
  }
  if (ticket.bets.length > 0) {
    return NextResponse.json({ error: "Bets already attached — issue the ticket" }, { status: 409 });
  }

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ ticket: updated });
}
