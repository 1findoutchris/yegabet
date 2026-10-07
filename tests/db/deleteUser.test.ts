import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { DELETE } from "@/app/api/admin/users/[id]/route";
import { makeUser, makeDepositRequest, truncateAll } from "../factories";
import { adminAuth } from "../helpers/auth";
import { json, params, req } from "../helpers/req";

/*
 * Deleting a player is the one admin action with no undo, so both halves are
 * pinned here: the refusals that protect money, and the child-row sweep.
 *
 * The sweep is why this is a DB test rather than a unit test — the failure mode
 * is a foreign key nobody remembered (add a table with a userId, forget the
 * deleteMany, and every delete of an active player 500s). Every FK-constrained
 * child table gets a row below; a missing one fails right here.
 */

async function del(id: string) {
  const auth = await adminAuth();
  return json<{ error?: string }>(
    await DELETE(req("DELETE", `/api/admin/users/${id}`, auth), params({ id }))
  );
}

/** One row in every table that carries a userId, FK-constrained or not. */
async function giveHistory(userId: string) {
  const bonus = await prisma.bonus.create({
    data: { name: "Test bonus", amount: 50 },
  });
  await Promise.all([
    prisma.transaction.create({
      data: { userId, type: "DEPOSIT", status: "COMPLETED", amount: 100, balanceBefore: 0, balanceAfter: 100 },
    }),
    prisma.bet.create({
      data: { userId, amount: 10, potentialWin: 20, odds: 2 },
    }),
    prisma.userBonus.create({
      data: { userId, bonusId: bonus.id, amount: 50, remaining: 50 },
    }),
    prisma.withdrawalRequest.create({
      data: { userId, amount: 60, method: "telebirr", account: "0912345678", accountName: "Test", status: "PAID" },
    }),
    makeDepositRequest(userId, { status: "APPROVED" }),
    prisma.recentGame.create({ data: { userId, gameId: "g1" } }),
    prisma.favoriteGame.create({ data: { userId, gameId: "g1" } }),
    prisma.session.create({
      data: { userId, token: `tok-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) },
    }),
    prisma.pushSubscription.create({
      data: { userId, endpoint: `https://push.test/${userId}`, p256dh: "k", auth: "a" },
    }),
    prisma.spinResult.create({
      data: { userId, label: "No win", kind: "NONE", reference: `spin-${userId}` },
    }),
    // Every player who has opened a provider game has one — the RESTRICT
    // foreign key that used to make delete 500 for any active player.
    prisma.gameSession.create({ data: { userId, sessionId: `gs-${userId}`, gameId: "g1" } }),
    prisma.nativePushToken.create({ data: { userId, token: `np-${userId}`, platform: "android" } }),
  ]);
}

beforeAll(async () => {
  await truncateAll();
});

describe("DELETE /api/admin/users/[id]", () => {
  test("erases the account and every child row", async () => {
    const user = await makeUser();
    const referred = await makeUser({ referredById: user.id });
    await giveHistory(user.id);
    await prisma.spinCreditGrant.create({
      data: { referrerId: user.id, refereeId: referred.id, credits: 1 },
    });

    const { status, body } = await del(user.id);
    expect(status, JSON.stringify(body)).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    const counts = await Promise.all([
      prisma.transaction.count({ where: { userId: user.id } }),
      prisma.bet.count({ where: { userId: user.id } }),
      prisma.userBonus.count({ where: { userId: user.id } }),
      prisma.withdrawalRequest.count({ where: { userId: user.id } }),
      prisma.depositRequest.count({ where: { userId: user.id } }),
      prisma.recentGame.count({ where: { userId: user.id } }),
      prisma.favoriteGame.count({ where: { userId: user.id } }),
      prisma.session.count({ where: { userId: user.id } }),
      prisma.pushSubscription.count({ where: { userId: user.id } }),
      prisma.spinResult.count({ where: { userId: user.id } }),
      prisma.spinCreditGrant.count({ where: { referrerId: user.id } }),
      prisma.gameSession.count({ where: { userId: user.id } }),
      prisma.nativePushToken.count({ where: { userId: user.id } }),
    ]);
    expect(counts).toEqual(new Array(counts.length).fill(0));

    // Someone they referred survives, detached — deleting a referrer must not
    // take their downline with it.
    const survivor = await prisma.user.findUnique({ where: { id: referred.id } });
    expect(survivor?.referredById).toBeNull();
  });

  test("refuses while the account still holds money", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const { status, body } = await del(user.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/still holds ETB 200/i);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  test("refuses while a payout is in flight", async () => {
    const user = await makeUser();
    await prisma.withdrawalRequest.create({
      data: { userId: user.id, amount: 60, method: "telebirr", account: "0912345678", accountName: "Test" },
    });

    const { status, body } = await del(user.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/withdrawal/i);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  test("404s on an unknown id", async () => {
    expect((await del("nope")).status).toBe(404);
  });
});

describe("DELETE /api/admin/users/[id] — every role except admin", () => {
  const setRole = (id: string, role: "AGENT" | "AFFILIATE" | "IN_PERSON_AGENT" | "ADMIN" | "SUPERADMIN") =>
    prisma.user.update({ where: { id }, data: { role } });

  test.each(["ADMIN", "SUPERADMIN"] as const)("refuses %s", async (role) => {
    const u = await makeUser();
    await setRole(u.id, role);
    const { status, body } = await del(u.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/Admin accounts/);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
  });

  test("AGENT: portal row removed, its players kept and detached", async () => {
    const u = await makeUser();
    await setRole(u.id, "AGENT");
    const agent = await prisma.agent.create({ data: { userId: u.id, code: `AG${u.id.slice(-6)}` } });
    await prisma.agentDeposit.create({ data: { agentId: agent.id, amount: 10, reference: `ad-${u.id}` } });
    const player = await makeUser();
    await prisma.user.update({ where: { id: player.id }, data: { agentId: agent.id } });

    const { status, body } = await del(u.id);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await prisma.agent.findUnique({ where: { id: agent.id } })).toBeNull();
    expect(await prisma.agentDeposit.count({ where: { agentId: agent.id } })).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: player.id } }))?.agentId).toBeNull();
  });

  test("AFFILIATE: portal row removed, its players kept and detached", async () => {
    const u = await makeUser();
    await setRole(u.id, "AFFILIATE");
    const aff = await prisma.affiliate.create({ data: { userId: u.id, code: `AF${u.id.slice(-6)}` } });
    const player = await makeUser();
    await prisma.user.update({ where: { id: player.id }, data: { affiliateId: aff.id } });

    const { status } = await del(u.id);
    expect(status).toBe(200);
    expect(await prisma.affiliate.findUnique({ where: { id: aff.id } })).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: player.id } }))?.affiliateId).toBeNull();
  });

  async function agentWithTicket(status: string) {
    const u = await makeUser();
    await setRole(u.id, "IN_PERSON_AGENT");
    const txn = await prisma.transaction.create({
      data: { userId: u.id, type: "BET", status: "COMPLETED", amount: 20, balanceBefore: 20, balanceAfter: 0, reference: `t-${u.id}-${status}` },
    });
    await prisma.ticketCheckCode.create({ data: { code: `P-${u.id.slice(-8).toUpperCase()}`, transactionId: txn.id } });
    const ticket = await prisma.ticket.create({
      data: { publicId: `T-${u.id.slice(-6).toUpperCase()}`, agentId: u.id, status, totalStake: 20 },
    });
    await prisma.ticketBet.create({ data: { ticketId: ticket.id, transactionId: txn.id, betAmount: 20 } });
    return { u, ticket };
  }

  test.each(["PLACED", "WON"])("IN_PERSON_AGENT with a %s ticket: refused (a customer can still collect)", async (st) => {
    const { u } = await agentWithTicket(st);
    const { status, body } = await del(u.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/still in play or won but unpaid/);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
  });

  test.each(["LOST", "PAID"])("IN_PERSON_AGENT with only %s tickets: deleted with tickets", async (st) => {
    const { u, ticket } = await agentWithTicket(st);
    const { status, body } = await del(u.id);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toBeNull();
    expect(await prisma.ticketBet.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});
