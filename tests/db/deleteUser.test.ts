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

  test("refuses an agent account, whose portal row has no foreign key to cascade", async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { role: "AGENT" } });

    const { status } = await del(user.id);
    expect(status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  test("404s on an unknown id", async () => {
    expect((await del("nope")).status).toBe(404);
  });
});
