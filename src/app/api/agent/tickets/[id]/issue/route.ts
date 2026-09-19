import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";

/**
 * POST — issue the ticket: OPEN → PLACED (or straight to WON/LOST if every
 * attached bet already settled while the draft was open). Requires at least
 * one attached bet — an empty ticket is cancelled, not issued.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id, agentId: auth.userId },
      include: { bets: { select: { settled: true } } },
    });
    if (!ticket) return { error: "Ticket not found", status: 404 } as const;
    if (ticket.status !== "OPEN") return { error: "Ticket is not open", status: 409 } as const;
    if (ticket.bets.length === 0) return { error: "No bets attached yet", status: 400 } as const;

    const allSettled = ticket.bets.every((b) => b.settled);
    const status = !allSettled ? "PLACED" : Number(ticket.totalWin) > 0 ? "WON" : "LOST";

    const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status } });
    return { ticket: updated } as const;
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ticket: result.ticket });
}
