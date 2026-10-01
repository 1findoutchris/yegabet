import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asAnon, asUser } from "../helpers/session";
import { GET as listUser } from "@/app/api/user/tickets/route";
import { GET as getUser } from "@/app/api/user/tickets/[id]/route";
import { GET as listAgent } from "@/app/api/agent/tickets/route";
import { GET as getAgent } from "@/app/api/agent/tickets/[id]/route";

/*
 * Ticket History / Find Ticket for players (GET /api/user/tickets[/id]) and
 * the in-person agent ticket APIs it was built from.
 *
 * Players' tickets are their own sportsbook bets (Transaction rows), so the
 * thing that matters most: a player only ever sees their own, whatever id they
 * put in the URL — and agents keep exactly the access they had.
 */

const SPORTS = "nova:sports-betby:sports";
const info = (team1: string, team2: string, outcome: string, k: number) =>
  JSON.stringify({ detail: JSON.stringify({ legs: [{ team1, team2, market_type_name: "1x2", outcome_display_name: outcome, coeficient: k }], k }) });

let seq = 0;
async function txn(userId: string, type: "BET" | "WIN" | "REFUND", metadata: Record<string, unknown>, reference = `gm:${900000 + ++seq}`) {
  return prisma.transaction.create({
    data: { userId, type, status: "COMPLETED", amount: 0, balanceBefore: 0, balanceAfter: 0, reference, metadata: metadata as object, createdAt: new Date(Date.now() + seq * 1000) },
  });
}

type Row = { id: string; publicId: string; status: string; totalStake: string; totalWin: string };
const list = async (search = "") =>
  json<{ tickets: Row[] }>(await listUser(req("GET", `/api/user/tickets${search ? `?search=${encodeURIComponent(search)}` : ""}`)));
const detail = async (id: string) =>
  json<{ ticket: Row & { bets: { info: unknown }[] } }>(await getUser(req("GET", `/api/user/tickets/${id}`), { params: Promise.resolve({ id }) }));

let alice: { id: string }, bob: { id: string }, agent: { id: string };
let pending: { id: string; reference: string }, won: { id: string }, lost: { id: string };
let cancelled: { id: string }, bobBet: { id: string }, casinoSpin: { id: string }, winRow: { id: string };
let agentTicket: { id: string; publicId: string };

beforeAll(async () => {
  await truncateAll();
  alice = await makeUser();
  bob = await makeUser();
  const a = await makeUser();
  agent = await prisma.user.update({ where: { id: a.id }, data: { role: "IN_PERSON_AGENT", commissionRate: 5 } });

  // Alice — one bet in each state, plus a casino spin that must not show up.
  pending = await txn(alice.id, "BET", { gameId: SPORTS, roundId: "r1", bet: 100, win: 0, info: info("Arsenal", "Liverpool", "Arsenal", 2.1) });
  won = await txn(alice.id, "BET", { gameId: SPORTS, roundId: "r2", bet: 50, win: 0, info: info("Barcelona", "Real Madrid", "Barcelona", 3) });
  winRow = await txn(alice.id, "WIN", { gameId: SPORTS, roundId: "r2", bet: 0, win: 150 });
  lost = await txn(alice.id, "BET", { gameId: SPORTS, roundId: "r3", bet: 20, win: 0, info: info("Inter", "Milan", "Draw", 3.2) });
  await txn(alice.id, "WIN", { gameId: SPORTS, roundId: "r3", bet: 0, win: 0 });
  const c = await txn(alice.id, "BET", { gameId: SPORTS, roundId: "r4", bet: 30, win: 0, info: info("Ajax", "PSV", "PSV", 2.5) });
  await txn(alice.id, "REFUND", { gameId: SPORTS, rolledBackTransaction: c.reference }, `${c.reference}:rollback`);
  cancelled = c;
  casinoSpin = await txn(alice.id, "BET", { gameId: "black:pg:1024", roundId: "s1", bet: 10, win: 0 });

  // Bob — a bet Alice must never reach.
  bobBet = await txn(bob.id, "BET", { gameId: SPORTS, roundId: "b1", bet: 999, win: 0, info: info("Bob FC", "Rivals", "Bob FC", 1.5) });

  // Agent — a real printed ticket.
  agentTicket = await prisma.ticket.create({ data: { publicId: "T-AGENT1", agentId: agent.id, status: "PLACED", totalStake: 40 } });
});

describe("player Ticket History", () => {
  test("anonymous → 401 on list and detail", async () => {
    asAnon();
    expect((await list()).status).toBe(401);
    expect((await detail(pending.id)).status).toBe(401);
  });

  test("lists only the player's own sportsbook bets, newest first, with statuses", async () => {
    asUser({ id: alice.id });
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.tickets.map((t) => t.id)).toEqual([cancelled.id, lost.id, won.id, pending.id]);
    expect(Object.fromEntries(body.tickets.map((t) => [t.id, t.status]))).toEqual({
      [pending.id]: "PLACED", [won.id]: "WON", [lost.id]: "LOST", [cancelled.id]: "CANCELLED",
    });
    expect(body.tickets.find((t) => t.id === won.id)!.totalWin).toBe("150");
    const ids = body.tickets.map((t) => t.id);
    expect(ids).not.toContain(bobBet.id);
    expect(ids).not.toContain(casinoSpin.id);
    expect(ids).not.toContain(winRow.id);
  });

  test("opens an own ticket with its bet slip", async () => {
    asUser({ id: alice.id });
    const { status, body } = await detail(won.id);
    expect(status).toBe(200);
    expect(body.ticket).toMatchObject({ id: won.id, status: "WON", totalStake: "50", totalWin: "150" });
    expect(String(body.ticket.bets[0].info)).toContain("Barcelona");
  });
});

describe("player cannot reach other tickets by editing the URL", () => {
  test.each([
    ["another player's bet", () => bobBet.id],
    ["an agent ticket id", () => agentTicket.id],
    ["own casino spin", () => casinoSpin.id],
    ["own win/settle row", () => winRow.id],
    ["a made-up id", () => "does-not-exist"],
  ])("%s → 404", async (_label, id) => {
    asUser({ id: alice.id });
    expect((await detail(id())).status).toBe(404);
  });

  test("Bob can open his own bet but none of Alice's", async () => {
    asUser({ id: bob.id });
    expect((await detail(bobBet.id)).status).toBe(200);
    expect((await detail(pending.id)).status).toBe(404);
    expect((await list()).body.tickets.map((t) => t.id)).toEqual([bobBet.id]);
  });
});

describe("player Find Ticket", () => {
  test("by ticket code", async () => {
    asUser({ id: alice.id });
    const code = pending.reference.replace(/^gm:/, "");
    expect((await list(code)).body.tickets.map((t) => t.id)).toEqual([pending.id]);
  });

  test("by team name, case-insensitive", async () => {
    asUser({ id: alice.id });
    expect((await list("barcelona")).body.tickets.map((t) => t.id)).toEqual([won.id]);
  });

  test("never matches another player's bet", async () => {
    asUser({ id: alice.id });
    expect((await list("Bob FC")).body.tickets).toEqual([]);
  });
});

describe("in-person agent ticket APIs are unchanged", () => {
  test("normal player is still refused (403)", async () => {
    asUser({ id: alice.id, role: "USER" });
    expect((await json(await listAgent(req("GET", "/api/agent/tickets")))).status).toBe(403);
    const r = await getAgent(req("GET", `/api/agent/tickets/${agentTicket.id}`), { params: Promise.resolve({ id: agentTicket.id }) });
    expect((await json(r)).status).toBe(403);
  });

  test("agent history, find and detail still work", async () => {
    asUser({ id: agent.id, role: "IN_PERSON_AGENT" });
    const all = await json<{ tickets: { id: string }[] }>(await listAgent(req("GET", "/api/agent/tickets")));
    expect(all.body.tickets.map((t) => t.id)).toEqual([agentTicket.id]);
    const found = await json<{ tickets: { id: string }[] }>(await listAgent(req("GET", "/api/agent/tickets?search=agent1")));
    expect(found.body.tickets.map((t) => t.id)).toEqual([agentTicket.id]);
    const one = await getAgent(req("GET", `/api/agent/tickets/${agentTicket.id}`), { params: Promise.resolve({ id: agentTicket.id }) });
    expect((await json<{ ticket: { publicId: string } }>(one)).body.ticket.publicId).toBe("T-AGENT1");
  });
});
