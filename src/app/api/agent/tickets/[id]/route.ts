import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { getGamesByIds } from "@/lib/games";
import { compareRebet } from "@/lib/ticketSlip";

/**
 * GET — one ticket with its bets. The agent uses this for the printable view
 * and to look up the ticket code when a customer comes back to collect.
 *
 * A "Bet this ticket" copy also gets `copiedFrom` (the original's code) and
 * `rebet` — the original's selections compared against what's been placed on
 * this ticket so far. Only parsed selection text and the reference stake leave
 * the original; its raw provider payload does not.
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

  // Resolve provider game uids to display names for the printed slip.
  // Sportsbook bets carry the sportsbook uid — label it directly.
  const gameIds = ticket.bets.map((b) => b.gameId).filter((g): g is string => !!g);
  const catalog = new Map(getGamesByIds(gameIds).map((g) => [g.gameID, g.gameNameEn]));
  const bets = ticket.bets.map((b) => ({
    ...b,
    gameName: b.gameId
      ? b.gameId.includes("sports") ? "Sportsbook" : (catalog.get(b.gameId) ?? b.gameId)
      : null,
  }));

  let copiedFrom: { id: string; publicId: string; totalStake: unknown } | null = null;
  let rebet = null;
  if (ticket.copiedFromTicketId) {
    const original = await prisma.ticket.findFirst({
      where: { id: ticket.copiedFromTicketId, agentId: auth.userId },
      select: { id: true, publicId: true, totalStake: true, bets: { select: { info: true } } },
    });
    if (original) {
      copiedFrom = { id: original.id, publicId: original.publicId, totalStake: original.totalStake };
      rebet = compareRebet(original.bets, ticket.bets, Date.now());
    }
  }

  return NextResponse.json({ ticket: { ...ticket, bets, copiedFrom, rebet } });
}
