import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { getGamesByIds } from "@/lib/games";
import { settleInfoByRound } from "@/lib/userTickets";

/**
 * GET — one ticket with its bets. The agent uses this for the printable view
 * and to look up the ticket code when a customer comes back to collect.
 * Each bet also gets `resultInfo` — the provider's settle payload for its
 * round, which carries each match's own result.
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
  const results = await settleInfoByRound(
    auth.userId,
    ticket.bets.map((b) => b.gameRound).filter((r): r is string => !!r)
  );
  const bets = ticket.bets.map((b) => ({
    ...b,
    resultInfo: b.gameRound ? (results.get(b.gameRound) ?? null) : null,
    gameName: b.gameId
      ? b.gameId.includes("sports") ? "Sportsbook" : (catalog.get(b.gameId) ?? b.gameId)
      : null,
  }));

  return NextResponse.json({ ticket: { ...ticket, bets } });
}
