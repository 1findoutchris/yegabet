import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asAnon, asUser } from "../helpers/session";
import { POST as rebet } from "@/app/api/agent/tickets/[id]/rebet/route";
import { GET as getTicket } from "@/app/api/agent/tickets/[id]/route";
import { POST as openDraft } from "@/app/api/agent/tickets/route";

/*
 * "Bet this ticket" — POST /api/agent/tickets/[id]/rebet.
 *
 * The route only ever opens a draft. What matters most: it's agent-only on the
 * server, it never touches the original ticket, and a double click can't open
 * two drafts.
 */

const HOUR = 3600;
const nowS = () => Math.floor(Date.now() / 1000);

const info = (legs: Record<string, unknown>[], k: number) =>
  JSON.stringify({ detail: JSON.stringify({ legs, k }) });
const leg = (team1: string, team2: string, outcome: string, coeficient: number, start_ts: number) =>
  ({ team1, team2, market_type_name: "1x2", outcome_display_name: outcome, coeficient, start_ts });

async function makeAgent() {
  const u = await makeUser({ balance: 5000 });
  return prisma.user.update({ where: { id: u.id }, data: { role: "IN_PERSON_AGENT", commissionRate: 5 } });
}

/** An issued ticket holding one sportsbook bet with the given legs. */
async function makeTicket(agentId: string, status: string, legs: Record<string, unknown>[] | null, stake = 500) {
  const ticket = await prisma.ticket.create({
    data: { publicId: `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, agentId, status, totalStake: legs ? stake : 0 },
  });
  if (legs) await attachBet(agentId, ticket.id, info(legs, 3.5), stake);
  return ticket;
}

async function attachBet(agentId: string, ticketId: string, infoStr: string, stake: number) {
  const tx = await prisma.transaction.create({
    data: { userId: agentId, type: "BET", status: "COMPLETED", amount: stake, balanceBefore: 5000, balanceAfter: 5000 - stake },
  });
  await prisma.ticketBet.create({
    data: { ticketId, transactionId: tx.id, betAmount: stake, info: infoStr, gameId: "nova:sports-betby:sports" },
  });
}

type RebetBody = { error?: string; ticket: { id: string; publicId: string; copiedFromTicketId: string | null } };
type DetailBody = {
  ticket: {
    copiedFrom: { publicId: string; totalStake: string };
    rebet: { legs: { state: string; oldOdds: string | null; newOdds: string | null }[] };
  };
};

const call = (id: string) => rebet(req("POST", `/api/agent/tickets/${id}/rebet`), { params: Promise.resolve({ id }) });
const asAgent = (a: { id: string }) => asUser({ id: a.id, role: "IN_PERSON_AGENT" });

let agent: Awaited<ReturnType<typeof makeAgent>>;
const upcoming = () => [
  leg("Manchester United", "Chelsea", "Manchester United", 1.85, nowS() + 2 * HOUR),
  leg("Arsenal", "Liverpool", "Arsenal", 1.9, nowS() + 3 * HOUR),
];

beforeEach(async () => {
  await truncateAll();
  agent = await makeAgent();
});

describe("authorization", () => {
  test("anonymous → 401", async () => {
    const t = await makeTicket(agent.id, "PLACED", upcoming());
    asAnon();
    expect((await json<RebetBody>(await call(t.id))).status).toBe(401);
  });

  test("normal user → 403, even with a real ticket id", async () => {
    const t = await makeTicket(agent.id, "PLACED", upcoming());
    const user = await makeUser();
    asUser({ id: user.id, role: "USER" });
    expect((await json<RebetBody>(await call(t.id))).status).toBe(403);
  });

  test("another agent's ticket → 404", async () => {
    const other = await makeAgent();
    const t = await makeTicket(other.id, "PLACED", upcoming());
    asAgent(agent);
    expect((await json<RebetBody>(await call(t.id))).status).toBe(404);
  });

  test("unknown ticket → 404", async () => {
    asAgent(agent);
    expect((await json<RebetBody>(await call("nope"))).status).toBe(404);
  });
});

describe("what can be copied", () => {
  test("cancelled ticket → 409", async () => {
    const t = await makeTicket(agent.id, "CANCELLED", upcoming());
    asAgent(agent);
    const { status, body } = await json<RebetBody>(await call(t.id));
    expect(status).toBe(409);
    expect(body.error).toMatch(/cancelled/i);
  });

  test("open draft → 409", async () => {
    const t = await makeTicket(agent.id, "OPEN", upcoming());
    asAgent(agent);
    expect((await json<RebetBody>(await call(t.id))).status).toBe(409);
  });

  test("no parseable selections → 422", async () => {
    const t = await makeTicket(agent.id, "LOST", null);
    asAgent(agent);
    expect((await json<RebetBody>(await call(t.id))).status).toBe(422);
  });

  test("every selection already started → 409, no draft opened", async () => {
    const t = await makeTicket(agent.id, "LOST", [leg("A", "B", "A", 2, nowS() - HOUR)]);
    asAgent(agent);
    const { status, body } = await json<RebetBody>(await call(t.id));
    expect(status).toBe(409);
    expect(body.error).toMatch(/already started/i);
    expect(await prisma.ticket.count({ where: { agentId: agent.id, status: "OPEN" } })).toBe(0);
  });
});

describe("copying", () => {
  test("opens a linked draft and leaves the original untouched", async () => {
    const original = await makeTicket(agent.id, "WON", upcoming());
    const before = await prisma.ticket.findUnique({ where: { id: original.id }, include: { bets: true } });
    const balanceBefore = (await prisma.user.findUnique({ where: { id: agent.id } }))!.balance;

    asAgent(agent);
    const { status, body } = await json<RebetBody>(await call(original.id));
    expect(status).toBe(201);
    expect(body.ticket.copiedFromTicketId).toBe(original.id);
    expect(body.ticket.publicId).not.toBe(original.publicId);

    const draft = await prisma.ticket.findUnique({ where: { id: body.ticket.id }, include: { bets: true } });
    expect(draft!.status).toBe("OPEN");
    expect(draft!.bets).toHaveLength(0);            // nothing placed by the click
    expect(Number(draft!.totalStake)).toBe(0);      // stake not copied

    const after = await prisma.ticket.findUnique({ where: { id: original.id }, include: { bets: true } });
    expect(after).toEqual(before);                  // original byte-for-byte unchanged
    expect((await prisma.user.findUnique({ where: { id: agent.id } }))!.balance).toEqual(balanceBefore);
  });

  test("double click returns the same draft (200), never a second one", async () => {
    const original = await makeTicket(agent.id, "PLACED", upcoming());
    asAgent(agent);
    const [a, b] = await Promise.all([json<RebetBody>(await call(original.id)), json<RebetBody>(await call(original.id))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.ticket.id).toBe(b.body.ticket.id);
    expect(await prisma.ticket.count({ where: { agentId: agent.id, status: "OPEN" } })).toBe(1);
  });

  test("a different open draft blocks the copy (409) and the plain open route still enforces one draft", async () => {
    const original = await makeTicket(agent.id, "PLACED", upcoming());
    asAgent(agent);
    expect((await json(await openDraft(req("POST", "/api/agent/tickets")))).status).toBe(201);
    const { status, body } = await json<RebetBody>(await call(original.id));
    expect(status).toBe(409);
    expect(body.ticket).toBeTruthy();
    expect((await json(await openDraft(req("POST", "/api/agent/tickets")))).status).toBe(409);
  });
});

describe("comparison on the copy", () => {
  test("pending → placed / odds changed as the new bet attaches; started legs flagged", async () => {
    const legs = [...upcoming(), leg("Barcelona", "Real Madrid", "Barcelona", 2.1, nowS() - HOUR)];
    const original = await makeTicket(agent.id, "LOST", legs, 500);
    asAgent(agent);
    const { body } = await json<RebetBody>(await call(original.id));
    const draftId = body.ticket.id;
    const read = async () =>
      (await json<DetailBody>(await getTicket(req("GET", `/api/agent/tickets/${draftId}`), { params: Promise.resolve({ id: draftId }) }))).body.ticket;

    let t = await read();
    expect(t.copiedFrom.publicId).toBe(original.publicId);
    expect(Number(t.copiedFrom.totalStake)).toBe(500);
    expect(t.rebet.legs.map((l) => l.state)).toEqual(["pending", "pending", "started"]);
    expect(JSON.stringify(t.copiedFrom)).not.toContain("detail"); // no raw provider payload from the original

    // Agent re-places two legs in BetBy; Arsenal's price has moved.
    await attachBet(agent.id, draftId, info([legs[0], { ...legs[1], coeficient: 2.05 }], 3.79), 300);
    t = await read();
    expect(t.rebet.legs.map((l) => l.state)).toEqual(["placed", "odds_changed", "started"]);
    expect(t.rebet.legs[1]).toMatchObject({ oldOdds: "1.9", newOdds: "2.05" });
  });
});
