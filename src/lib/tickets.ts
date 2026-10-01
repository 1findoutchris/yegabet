import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { roundETB } from "./utils";

/*
 * In-person betting agent — ticket lifecycle.
 *
 * A Ticket is the printed receipt a walk-in customer holds. The agent (a User
 * with role IN_PERSON_AGENT) opens a draft with the customer's name + phone,
 * places bets in the sportsbook iframe, and the provider wallet callback
 * attaches each BET Transaction to the open ticket via TicketBet.
 *
 *   OPEN      — draft; new BET transactions attach here
 *   PLACED    — issued/printed; waiting for results
 *   WON/LOST  — every bet settled; WON means the customer is owed totalWin
 *   PAID      — agent paid the customer, receipt in proofKey
 *   CANCELLED — draft voided before issue
 *
 * Money truth stays in Transaction — a ticket never moves funds, it only
 * groups the agent's own BET/WIN rows under a customer-facing code.
 */

export const TICKET_STATUSES = ["OPEN", "PLACED", "WON", "LOST", "PAID", "CANCELLED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

type Tx = Prisma.TransactionClient;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — read aloud safely

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Short quotable ticket code ("T-3F9K2A") — same pattern as WithdrawalRequest.publicId. */
export async function generateTicketCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `T-${randomCode(6)}`;
    const clash = await tx.ticket.findUnique({ where: { publicId: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `T-${randomCode(10)}`;
}

/**
 * Serialise draft-opening per agent for the rest of the transaction. The
 * "one OPEN draft per agent" rule is a read-then-insert; without this, two
 * fast clicks (or "Open ticket" racing "Bet this ticket") both see no draft
 * and both create one, and bets would then attach to whichever comes first.
 */
export async function lockAgentTickets(tx: Tx, agentId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ticket-open:" + agentId}))`;
}

/**
 * Attach a just-created BET transaction to the agent's open ticket, if any.
 * Called inside the wallet-callback transaction so the link is atomic with the
 * balance update. Combined rounds (bet+win in one callback) attach already
 * settled. Returns the ticket id or null when the agent has no open draft —
 * an orphan bet is simply the agent's own, no ticket.
 */
export async function attachBetToOpenTicket(
  tx: Tx,
  agentId: string,
  transactionId: string,
  betAmount: number,
  gameRound: string | null,
  winAmount = 0,
  gameId: string | null = null,
  info: unknown = undefined
): Promise<string | null> {
  const ticket = await tx.ticket.findFirst({
    where: { agentId, status: "OPEN" },
    select: { id: true },
  });
  if (!ticket) return null;

  const settled = winAmount > 0;
  await tx.ticketBet.create({
    data: {
      ticketId: ticket.id,
      transactionId,
      gameRound,
      gameId,
      // undefined → column stays NULL; null → JSON null. Only store real payloads.
      info: info === undefined || info === null ? undefined : (info as Prisma.InputJsonValue),
      betAmount,
      winAmount: roundETB(winAmount),
      settled,
    },
  });
  await tx.ticket.update({
    where: { id: ticket.id },
    data: {
      totalStake: { increment: roundETB(betAmount) },
      ...(settled ? { totalWin: { increment: roundETB(winAmount) } } : {}),
    },
  });
  return ticket.id;
}

/**
 * A pure-WIN callback settled a round — find the matching open bet by
 * gameRound and record the payout, then refresh the ticket's status.
 */
export async function settleTicketBet(
  tx: Tx,
  agentId: string,
  gameRound: string | null,
  winAmount: number
): Promise<void> {
  if (!gameRound || winAmount <= 0) return;

  const bet = await tx.ticketBet.findFirst({
    where: { gameRound, settled: false, ticket: { agentId } },
    select: { id: true, ticketId: true },
  });
  if (!bet) return;

  await tx.ticketBet.update({
    where: { id: bet.id },
    data: { winAmount: roundETB(winAmount), settled: true },
  });
  await tx.ticket.update({
    where: { id: bet.ticketId },
    data: { totalWin: { increment: roundETB(winAmount) } },
  });
  await refreshTicketStatus(tx, bet.ticketId);
}

/**
 * PLACED → WON/LOST once every attached bet has settled. OPEN drafts are left
 * alone — the agent may still be adding bets; the same check runs again at
 * issue time. PAID/CANCELLED are terminal.
 */
export async function refreshTicketStatus(tx: Tx, ticketId: string): Promise<void> {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, totalWin: true, bets: { select: { settled: true } } },
  });
  if (!ticket || ticket.status !== "PLACED" || ticket.bets.length === 0) return;
  if (!ticket.bets.every((b) => b.settled)) return;

  await tx.ticket.update({
    where: { id: ticketId },
    data: { status: Number(ticket.totalWin) > 0 ? "WON" : "LOST" },
  });
}

/** Commission an in-person agent earns on one stake, in ETB. */
export function agentCommission(stakeETB: number, ratePct: number): number {
  return roundETB((stakeETB * ratePct) / 100);
}
