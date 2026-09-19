import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";

/**
 * GET — one ticket with its bets. The agent uses this for the printable view
 * and to double-check name/phone when a customer comes back to collect.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const { id } = await params;
  const ticket = await prisma.ticket.findFirst({
    where: { id, agentId: auth.userId },
    include: {
      bets: {
        include: {
          transaction: { select: { reference: true, amount: true, createdAt: true, metadata: true } },
        },
      },
    },
  });

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
