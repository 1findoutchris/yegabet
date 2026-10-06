import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asAnon, asUser } from "../helpers/session";
import { GET as check } from "@/app/api/tickets/check/route";
import { GET as listUser } from "@/app/api/user/tickets/route";
import { CHECKS_PER_MINUTE } from "@/lib/ticketCheck";

/*
 * Public "Check Ticket" — GET /api/tickets/check?code=.
 *
 * Anyone with a code sees the ticket; nobody learns who owns it, and codes
 * that could be enumerated (the provider's sequential numbers) don't work.
 */

const SPORTS = "nova:sports-betby:sports";
// Shaped like the real BetBy payload — including the fields that must NOT leak.
const payload = (betId: number, outcomes: number[]) => JSON.stringify({
  token: "SECRET-SESSION-TOKEN", userCode: "SECRET-USER-CODE", balance: 114.3, method: "ChangeBalance",
  detail: JSON.stringify({ bet_id: betId, k: 19.05, legs: [
    { team1: "Denmark", team2: "Portugal", market_type_name: "1x2", outcome_display_name: "Denmark", coeficient: 3.55, start_ts: 1790880300, outcome: outcomes[0], game_id: 2716146098921156618 },
    { team1: "Greece", team2: "Netherlands", market_type_name: "1x2", outcome_display_name: "Greece", coeficient: 3.55, start_ts: 1790880300, outcome: outcomes[1] },
  ] }),
});

let ipSeq = 0;
const callCheck = (code: string, ip = `10.0.0.${++ipSeq}`) =>
  check(req("GET", `/api/tickets/check?code=${encodeURIComponent(code)}`, { headers: { "x-forwarded-for": ip } }));

type Body = { error?: string; ticket?: { publicId: string; status: string; bets: { info: string | null; resultInfo: string | null }[] } };

let agent: { id: string }, player: { id: string };
let agentTicket: { publicId: string };
let playerCode: string;

beforeAll(async () => {
  await truncateAll();
  const a = await makeUser({ name: "Secret Agent Name" });
  agent = await prisma.user.update({ where: { id: a.id }, data: { role: "IN_PERSON_AGENT", commissionRate: 5 } });
  player = await makeUser({ name: "Secret Player Name" });

  // Agent's issued ticket with one bet, and its lost settle.
  const atx = await prisma.transaction.create({ data: { userId: agent.id, type: "BET", status: "COMPLETED", amount: 20, balanceBefore: 0, balanceAfter: 0, reference: "gm:500001", metadata: { gameId: SPORTS, roundId: "ra", bet: 20, win: 0, info: payload(0, [0, 0]) } } });
  await prisma.transaction.create({ data: { userId: agent.id, type: "WIN", status: "COMPLETED", amount: 0, balanceBefore: 0, balanceAfter: 0, reference: "gm:500002", metadata: { gameId: SPORTS, roundId: "ra", bet: 0, win: 0, info: payload(77, [0, 2]) } } });
  agentTicket = await prisma.ticket.create({ data: { publicId: "T-CHK234", agentId: agent.id, status: "PLACED", totalStake: 20 } });
  const t = await prisma.ticket.findUniqueOrThrow({ where: { publicId: "T-CHK234" } });
  await prisma.ticketBet.create({ data: { ticketId: t.id, transactionId: atx.id, betAmount: 20, gameRound: "ra", gameId: SPORTS, info: payload(0, [0, 0]) } });
  await prisma.ticket.create({ data: { publicId: "T-DRAFT2", agentId: agent.id, status: "OPEN" } });
  await prisma.ticket.create({ data: { publicId: "T-CANCL2", agentId: agent.id, status: "CANCELLED" } });

  // Player's own bet — lost.
  await prisma.transaction.create({ data: { userId: player.id, type: "BET", status: "COMPLETED", amount: 50, balanceBefore: 0, balanceAfter: 0, reference: "gm:600001", metadata: { gameId: SPORTS, roundId: "rp", bet: 50, win: 0, info: payload(0, [0, 0]) }, createdAt: new Date(Date.now() - 60000) } });
  await prisma.transaction.create({ data: { userId: player.id, type: "WIN", status: "COMPLETED", amount: 0, balanceBefore: 0, balanceAfter: 0, reference: "gm:600002", metadata: { gameId: SPORTS, roundId: "rp", bet: 0, win: 0, round_finished: true, info: payload(88, [2, 0]) } } });

  // The owner viewing their history is what assigns the check code.
  asUser({ id: player.id });
  const own = await json<{ tickets: { publicId: string }[] }>(await listUser(req("GET", "/api/user/tickets")));
  playerCode = own.body.tickets[0].publicId;
});

describe("public Check Ticket", () => {
  test("player tickets get a random P- code, not the provider's sequential number", () => {
    expect(playerCode).toMatch(/^P-[A-Z0-9]{8}$/);
    expect(playerCode).not.toContain("600001");
  });

  test("anyone (logged out) can check an agent ticket by its T- code, with per-match results", async () => {
    asAnon();
    const { status, body } = await json<Body>(await callCheck(agentTicket.publicId));
    expect(status).toBe(200);
    expect(body.ticket!.publicId).toBe("T-CHK234");
    expect(body.ticket!.status).toBe("PLACED");
    const legs = JSON.parse(JSON.parse(body.ticket!.bets[0].resultInfo!).detail).legs;
    expect(legs.map((l: { outcome: number }) => l.outcome)).toEqual([0, 2]);
  });

  test("anyone can check a player's bet by its P- code", async () => {
    asAnon();
    const { status, body } = await json<Body>(await callCheck(playerCode));
    expect(status).toBe(200);
    expect(body.ticket).toMatchObject({ publicId: playerCode, status: "LOST" });
  });

  test.each([["agent", () => "T-CHK234"], ["player", () => playerCode]])(
    "%s ticket: nothing identifying the owner or their wallet leaks", async (_l, code) => {
      asAnon();
      const text = JSON.stringify((await json<Body>(await callCheck(code()))).body);
      for (const secret of ["SECRET-SESSION-TOKEN", "SECRET-USER-CODE", "114.3", "Secret Agent Name", "Secret Player Name",
        agent.id, player.id, "gm:", "500001", "600001", "agentId", "userId", "betRef", "game_id", "2716146098921156618"]) {
        expect(text).not.toContain(secret);
      }
    });

  test("lowercase and spaces are accepted", async () => {
    expect((await json(await callCheck(" t-chk234 "))).status).toBe(200);
  });

  test("codes without the hyphen (as printed and scanned) find the same ticket", async () => {
    const agentRes = await json<Body>(await callCheck("TCHK234"));
    expect(agentRes.status).toBe(200);
    expect(agentRes.body.ticket!.publicId).toBe("T-CHK234");
    const playerRes = await json<Body>(await callCheck(playerCode.replace("-", "")));
    expect(playerRes.status).toBe(200);
    expect(playerRes.body.ticket!.publicId).toBe(playerCode);
  });

  test.each([
    ["draft agent ticket", "T-DRAFT2", 404],
    ["cancelled agent ticket", "T-CANCL2", 404],
    ["unknown T- code", "T-ZZZZZZ", 404],
    ["unknown P- code", "P-ZZZZZZZZ", 404],
    ["the provider's sequential number", "600001", 400],
    ["junk", "hello", 400],
  ])("%s → %i", async (_l, code, expected) => {
    expect((await json(await callCheck(code))).status).toBe(expected);
  });

  test(`more than ${CHECKS_PER_MINUTE} checks a minute from one IP → 429`, async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < CHECKS_PER_MINUTE; i++) {
      expect((await json(await callCheck("T-ZZZZZZ", ip))).status).toBe(404);
    }
    expect((await json(await callCheck("T-CHK234", ip))).status).toBe(429);
    expect((await json(await callCheck("T-CHK234", "203.0.113.10"))).status).toBe(200);
  });
});
