import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { SPORTSBOOK_GAME_UID } from "@/types/games";
import { parseSlip } from "./ticketSlip";
import { randomCode } from "./tickets";

/*
 * A player's own sportsbook bets, presented as tickets.
 *
 * In-person agents have real Ticket rows (printed receipts). Players don't —
 * but every sportsbook bet they place is already a Transaction whose metadata
 * is the provider callback payload: the bet-slip `info`, the `roundId`, the
 * stake and win. This turns those rows into the SAME shape the agent ticket
 * APIs return, so both roles share TicketList / TicketReceipt.
 *
 * Ownership: every query here is scoped to the caller's userId. There is no
 * way to read another player's bets through this module.
 *
 * Status, per bet (the BET transaction):
 *   CANCELLED — the provider rolled the bet back (`<ref>:rollback` row)
 *   WON       — the round paid out (a later win row, or win on the same call)
 *   LOST      — the round settled with no win
 *   PLACED    — waiting for the result
 */

type Row = {
  id: string;
  reference: string;
  createdAt: Date;
  metadata: Prisma.JsonValue;
};

/** Field names differ by provider: Gregmorn (bet/win/roundId/gameId/info), Silent (bet_amount/…/game_uid/data). */
function fields(metadata: Prisma.JsonValue) {
  const m = (metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>;
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  const finished = m.round_finished;
  return {
    gameId: s(m.gameId ?? m.game_uid),
    round: s(m.roundId ?? m.game_round),
    bet: n(m.bet ?? m.bet_amount),
    win: n(m.win ?? m.win_amount),
    info: (m.info ?? m.data ?? null) as unknown,
    roundFinished: finished === true || finished === "true",
  };
}

export function isSportsbookGame(gameId: string | null): boolean {
  return !!gameId && (gameId.includes("sports") || gameId === SPORTSBOOK_GAME_UID);
}

// Sportsbook rows only — casino spins never become tickets.
const SPORTSBOOK_FILTER: Prisma.TransactionWhereInput = {
  OR: [
    { metadata: { path: ["gameId"], string_contains: "sports" } },
    { metadata: { path: ["game_uid"], string_contains: "sports" } },
    { metadata: { path: ["game_uid"], equals: SPORTSBOOK_GAME_UID } },
  ],
};

const SELECT = { id: true, reference: true, createdAt: true, metadata: true } as const;

/** Human-facing bet code — the provider's transaction id without our namespace prefix. */
function betCode(reference: string): string {
  return reference.replace(/^gm:/, "");
}

/**
 * Pure: bets + the rows that settle/void them → ticket views. Wins in a round
 * are credited once, to the round's oldest bet.
 */
export function buildTickets(rows: Row[], rolledBack: Set<string>) {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const bets = sorted.filter((r) => fields(r.metadata).bet > 0);
  const firstBetOfRound = new Map<string, string>();
  for (const b of bets) {
    const round = fields(b.metadata).round;
    if (round && !firstBetOfRound.has(round)) firstBetOfRound.set(round, b.id);
  }

  return bets
    .map((b) => {
      const f = fields(b.metadata);
      const cancelled = rolledBack.has(b.reference);
      const ownsRound = f.round !== null && firstBetOfRound.get(f.round) === b.id;
      const settles = ownsRound
        ? sorted.filter((r) => r.id !== b.id && !rolledBack.has(r.reference) && fields(r.metadata).bet === 0 && fields(r.metadata).round === f.round)
        : [];
      const win = f.win + settles.reduce((sum, r) => sum + fields(r.metadata).win, 0);
      const settled = !cancelled && (win > 0 || settles.length > 0 || f.roundFinished);
      const status = cancelled ? "CANCELLED" : win > 0 ? "WON" : settled ? "LOST" : "PLACED";
      const createdAt = b.createdAt.toISOString();
      // Latest settle payload carries the legs' per-match results; a single
      // bet+win call that finished the round carries them itself.
      const lastSettle = settles.length > 0 ? settles[settles.length - 1] : null;
      const resultInfo = lastSettle ? fields(lastSettle.metadata).info : f.roundFinished ? f.info : null;
      return {
        id: b.id,
        // Replaced by the bet's random check code before it leaves this
        // module (attachCheckCodes); the provider number stays searchable.
        publicId: betCode(b.reference),
        betRef: betCode(b.reference),
        status,
        totalStake: String(f.bet),
        totalWin: String(cancelled ? 0 : win),
        createdAt,
        paidAt: null,
        bets: [{
          id: b.id,
          betAmount: String(f.bet),
          winAmount: String(cancelled ? 0 : win),
          settled,
          gameName: "Sportsbook",
          info: f.info,
          resultInfo,
          transaction: { createdAt },
        }],
      };
    })
    .reverse(); // newest first
}

export type UserTicket = ReturnType<typeof buildTickets>[number];

async function rolledBackRefs(userId: string, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await prisma.transaction.findMany({
    where: { userId, reference: { in: refs.map((r) => `${r}:rollback`) } },
    select: { reference: true },
  });
  return new Set(rows.map((r) => r.reference.replace(/:rollback$/, "")));
}

function matches(t: UserTicket, q: string): boolean {
  const needle = q.toLowerCase();
  if (t.publicId.toLowerCase().includes(needle) || t.betRef.toLowerCase().includes(needle)) return true;
  return t.bets.some((b) =>
    parseSlip(b.info).selections.some((s) =>
      `${s.match} ${s.marketPick ?? ""}`.toLowerCase().includes(needle)
    )
  );
}

/** Ticket history for one player. `search` matches the bet code or a team/market name. */
export async function listUserTickets(userId: string, search = "", take = 100): Promise<UserTicket[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, type: { in: ["BET", "WIN"] }, ...SPORTSBOOK_FILTER },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const tickets = buildTickets(rows, await rolledBackRefs(userId, rows.map((r) => r.reference)));
  const q = search.trim();
  await attachCheckCodes(tickets);
  return (q ? tickets.filter((t) => matches(t, q)) : tickets).slice(0, take);
}

/** One ticket — only if `id` is a sportsbook bet that belongs to `userId`. */
export async function getUserTicket(userId: string, id: string): Promise<UserTicket | null> {
  const bet = await prisma.transaction.findFirst({
    where: { id, userId, ...SPORTSBOOK_FILTER },
    select: SELECT,
  });
  if (!bet) return null;
  const { round, bet: stake } = fields(bet.metadata);
  if (stake <= 0) return null; // a win/settle row, not a bet

  const related = round
    ? await prisma.transaction.findMany({
        where: {
          userId,
          type: { in: ["BET", "WIN"] },
          OR: [
            { metadata: { path: ["roundId"], equals: round } },
            { metadata: { path: ["game_round"], equals: round } },
          ],
        },
        select: SELECT,
      })
    : [bet];
  const rows = related.some((r) => r.id === bet.id) ? related : [...related, bet];
  const tickets = buildTickets(rows, await rolledBackRefs(userId, rows.map((r) => r.reference)));
  const ticket = tickets.find((t) => t.id === bet.id) ?? null;
  if (ticket) await attachCheckCodes([ticket]);
  return ticket;
}

/**
 * The latest settle payload (bet = 0 row) per provider round for one user —
 * where the per-match results live. Used for agent tickets, whose TicketBet
 * only keeps the placement payload.
 */
export async function settleInfoByRound(userId: string, rounds: string[]): Promise<Map<string, unknown>> {
  const unique = [...new Set(rounds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: { in: ["BET", "WIN"] },
      OR: unique.flatMap((round) => [
        { metadata: { path: ["roundId"], equals: round } },
        { metadata: { path: ["game_round"], equals: round } },
      ]),
    },
    select: SELECT,
    orderBy: { createdAt: "asc" },
  });
  const out = new Map<string, unknown>();
  for (const r of rows) {
    const f = fields(r.metadata);
    if (f.round && f.bet === 0 && f.info != null) out.set(f.round, f.info); // later rows overwrite
  }
  return out;
}

/*
 * Public check codes (TicketCheckCode). A player's ticket number is a random
 * P-XXXXXXXX, not the provider's sequential transaction number — that one
 * would let anyone count through every player's bets on the public checker.
 * Assigned lazily, the first time the owner lists or opens the bet.
 */
const newCheckCode = () => `P-${randomCode(8)}`;

async function attachCheckCodes(tickets: UserTicket[]): Promise<void> {
  if (tickets.length === 0) return;
  const ids = tickets.map((t) => t.id);
  const read = () =>
    prisma.ticketCheckCode.findMany({ where: { transactionId: { in: ids } }, select: { code: true, transactionId: true } });

  let rows = await read();
  for (let attempt = 0; attempt < 3 && rows.length < ids.length; attempt++) {
    const have = new Set(rows.map((r) => r.transactionId));
    // skipDuplicates: a concurrent request (or a code clash) just loses the race; re-read below.
    await prisma.ticketCheckCode.createMany({
      data: ids.filter((id) => !have.has(id)).map((transactionId) => ({ code: newCheckCode(), transactionId })),
      skipDuplicates: true,
    });
    rows = await read();
  }
  const byTx = new Map(rows.map((r) => [r.transactionId, r.code]));
  for (const t of tickets) t.publicId = byTx.get(t.id) ?? t.publicId;
}
