import "server-only";
import { prisma } from "./prisma";
import { redis } from "./redis";
import { publicSlipInfo } from "./ticketSlip";
import { normalizeCode } from "./ticketCode";
import { getUserTicket, settleInfoByRound } from "./userTickets";

/*
 * Public "Check Ticket": anyone holding a ticket code can see that ticket —
 * its matches, picks, odds, per-match results, stake, and status.
 *
 * Two kinds of code, both random so they can't be enumerated:
 *   T-XXXXXX   — an in-person agent's printed ticket (Ticket.publicId)
 *   P-XXXXXXXX — a player's own sportsbook bet (TicketCheckCode)
 * Either may be typed or scanned without the hyphen (lib/ticketCode).
 *
 * The result never identifies anyone: no user/agent id, name, phone, balance,
 * provider references or raw payloads — slip data goes through publicSlipInfo.
 * Draft (OPEN) and CANCELLED agent tickets aren't checkable.
 */

export interface PublicTicket {
  id: string;
  publicId: string;
  status: string;
  totalStake: string;
  totalWin: string;
  createdAt: string;
  paidAt: string | null;
  bets: {
    id: string;
    betAmount: string;
    winAmount: string;
    settled: boolean;
    gameName: string | null;
    info: string | null;
    resultInfo: string | null;
    transaction: { createdAt: string };
  }[];
}

const CHECKABLE_AGENT_STATUSES = new Set(["PLACED", "WON", "LOST", "PAID"]);

export { normalizeCode };

async function agentTicket(code: string): Promise<PublicTicket | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { publicId: code },
    include: { bets: { include: { transaction: { select: { createdAt: true } } } } },
  });
  if (!ticket || !CHECKABLE_AGENT_STATUSES.has(ticket.status)) return null;

  const results = await settleInfoByRound(
    ticket.agentId,
    ticket.bets.map((b) => b.gameRound).filter((r): r is string => !!r)
  );
  return {
    id: ticket.publicId,
    publicId: ticket.publicId,
    status: ticket.status,
    totalStake: String(ticket.totalStake),
    totalWin: String(ticket.totalWin),
    createdAt: ticket.createdAt.toISOString(),
    paidAt: ticket.paidAt?.toISOString() ?? null,
    bets: ticket.bets.map((b, i) => ({
      id: String(i),
      betAmount: String(b.betAmount),
      winAmount: String(b.winAmount),
      settled: b.settled,
      gameName: b.gameId?.includes("sports") ? "Sportsbook" : null,
      info: publicSlipInfo(b.info),
      resultInfo: b.gameRound ? publicSlipInfo(results.get(b.gameRound)) : null,
      transaction: { createdAt: b.transaction.createdAt.toISOString() },
    })),
  };
}

async function playerTicket(code: string): Promise<PublicTicket | null> {
  const row = await prisma.ticketCheckCode.findUnique({
    where: { code },
    select: { transaction: { select: { id: true, userId: true } } },
  });
  if (!row) return null;
  const t = await getUserTicket(row.transaction.userId, row.transaction.id);
  if (!t) return null;
  return {
    id: code,
    publicId: code,
    status: t.status,
    totalStake: t.totalStake,
    totalWin: t.totalWin,
    createdAt: t.createdAt,
    paidAt: null,
    bets: t.bets.map((b, i) => ({
      id: String(i),
      betAmount: b.betAmount,
      winAmount: b.winAmount,
      settled: b.settled,
      gameName: b.gameName,
      info: publicSlipInfo(b.info),
      resultInfo: publicSlipInfo(b.resultInfo),
      transaction: b.transaction,
    })),
  };
}

export async function checkTicket(rawCode: string): Promise<PublicTicket | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  return code.startsWith("T-") ? agentTicket(code) : playerTicket(code);
}

/*
 * Per-IP throttle for the public checker. Codes are random (31^6 ≈ 887M for
 * agent tickets), so guessing is already hopeless; this keeps it that way and
 * stops anyone hammering the endpoint.
 */
export const CHECKS_PER_MINUTE = 30;

export async function allowCheck(ip: string): Promise<boolean> {
  const key = `ticketcheck:${ip}`;
  await redis.set(key, "0", "EX", 60, "NX");
  return (await redis.incr(key)) <= CHECKS_PER_MINUTE;
}
