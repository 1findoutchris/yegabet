import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { generateTicketCode, lockAgentTickets } from "@/lib/tickets";
import { hasStarted, templateSelections } from "@/lib/ticketSlip";

/**
 * POST — "Bet this ticket": open a new draft that uses an issued ticket's
 * selections as a template.
 *
 * This places NOTHING. Bets can only be placed inside the BetBy sportsbook
 * iframe, which is also the only thing that knows current odds and whether a
 * market is still open — so the agent rebuilds the slip there, enters the new
 * stake and confirms in BetBy's own bet slip. The new draft just carries
 * `copiedFromTicketId`, which drives the checklist on /sports (see
 * compareRebet) and stays on the ticket as the audit link.
 *
 * The original ticket is read, never written.
 *
 *   201 — new draft opened
 *   200 — a copy of THIS ticket is already the open draft (double click)
 *   404 — no such ticket for this agent
 *   409 — draft/cancelled original, every selection already started, or
 *         another draft is open
 *   422 — no sportsbook selections on the original to copy
 */
const COPYABLE = new Set(["PLACED", "WON", "LOST", "PAID"]);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    // Scoped to this agent — another agent's ticket code is a 404, not a copy.
    const source = await tx.ticket.findFirst({
      where: { id, agentId: auth.userId },
      select: { id: true, publicId: true, status: true, bets: { select: { info: true } } },
    });
    if (!source) return { status: 404, body: { error: "Ticket not found" } };

    if (source.status === "CANCELLED") {
      return { status: 409, body: { error: "Cancelled tickets can't be copied" } };
    }
    if (!COPYABLE.has(source.status)) {
      return { status: 409, body: { error: "This ticket is still a draft — issue it first" } };
    }

    const { legs } = templateSelections(source.bets);
    if (legs.length === 0) {
      return { status: 422, body: { error: "No sportsbook selections on this ticket to copy" } };
    }
    if (legs.every((l) => hasStarted(l, Date.now()))) {
      return { status: 409, body: { error: "Every selection on this ticket has already started — nothing left to bet" } };
    }

    await lockAgentTickets(tx, auth.userId);
    const open = await tx.ticket.findFirst({
      where: { agentId: auth.userId, status: "OPEN" },
      select: { id: true, publicId: true, copiedFromTicketId: true },
    });
    if (open) {
      if (open.copiedFromTicketId === source.id) return { status: 200, body: { ticket: open } };
      return { status: 409, body: { error: "Finish or cancel the open ticket first", ticket: open } };
    }

    const created = await tx.ticket.create({
      data: {
        publicId: await generateTicketCode(tx),
        agentId: auth.userId,
        copiedFromTicketId: source.id,
      },
      select: { id: true, publicId: true, copiedFromTicketId: true },
    });
    return { status: 201, body: { ticket: created } };
  });

  return NextResponse.json(result.body, { status: result.status });
}
