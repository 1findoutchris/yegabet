import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { cashDeposit, redeemCode, lookupCode, CashError } from "@/lib/cashAgent";
import { agentPosition } from "@/lib/agentLedger";
import { POST as withdrawPost } from "@/app/api/user/withdraw/route";
import { POST as cronPost } from "@/app/api/cron/agent-commission/route";
import { makeUser, makeWithdrawalAgent, truncateAll } from "../factories";
import { asUser } from "../helpers/session";
import { json, req } from "../helpers/req";

/*
 * The cash payout half: a code is money, so the properties that matter are that
 * it works exactly once, only for the agent it was issued to, and that paying it
 * moves the agent's float and the player's reserved balance in step.
 */

async function position(agentId: string) {
  const rows = await prisma.withdrawalAgentTxn.groupBy({
    by: ["type"], where: { agentId }, _sum: { amount: true },
  });
  return agentPosition(rows);
}

/** A player with `amount` of genuinely withdrawable balance. */
async function playerWithCash(amount: number) {
  return makeUser({ balance: amount, depositBalance: 0, bonusBalance: 0 });
}

/** Request a cash withdrawal through the real player route, as that player. */
async function requestCash(userId: string, agentId: string, amount: number) {
  asUser({ id: userId });
  return json<{ error?: string; publicId?: string }>(
    await withdrawPost(req("POST", "/api/user/withdraw", {
      body: { method: "cash", amount, agentId },
    })),
  );
}

describe("cash withdrawal by code", () => {
  beforeEach(async () => { await truncateAll(); });

  test("a code pays exactly once", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 0 });
    const user = await playerWithCash(1000);

    const wd = await prisma.withdrawalRequest.create({
      data: {
        userId: user.id, amount: 400, method: "cash",
        account: agent.username, accountName: "Agent",
        publicId: "W-TEST01", withdrawalAgentId: agent.id,
        txnReference: "wd-test-01",
      },
    });
    await prisma.transaction.create({
      data: {
        userId: user.id, type: "WITHDRAWAL", status: "PENDING", amount: 400,
        balanceBefore: 1000, balanceAfter: 600, reference: "wd-test-01",
      },
    });

    const first = await redeemCode(agent.id, "W-TEST01");
    expect(first.amount).toBe(400);
    // The agent handed out notes and took the balance, so float rises.
    expect((await position(agent.id)).float).toBe(400);

    // The reserved ledger row is now settled, not left hanging.
    const txn = await prisma.transaction.findFirstOrThrow({ where: { reference: "wd-test-01" } });
    expect(txn.status).toBe("COMPLETED");
    expect((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: wd.id } })).status).toBe("APPROVED");

    // Second attempt is refused and changes nothing.
    await expect(redeemCode(agent.id, "W-TEST01")).rejects.toMatchObject({ code: "CODE_ALREADY_USED" });
    expect((await position(agent.id)).float).toBe(400);
    expect(await prisma.withdrawalAgentTxn.count({ where: { type: "CASH_PAYOUT" } })).toBe(1);
  });

  test("another agent cannot claim someone else's code", async () => {
    const mine = await makeWithdrawalAgent({ isCashAgent: true });
    const theirs = await makeWithdrawalAgent({ isCashAgent: true });
    const user = await playerWithCash(1000);

    await prisma.withdrawalRequest.create({
      data: {
        userId: user.id, amount: 200, method: "cash",
        account: mine.username, accountName: "Agent",
        publicId: "W-TEST02", withdrawalAgentId: mine.id, txnReference: "wd-test-02",
      },
    });

    await expect(lookupCode(theirs.id, "W-TEST02")).rejects.toMatchObject({ code: "WRONG_AGENT" });
    await expect(redeemCode(theirs.id, "W-TEST02")).rejects.toMatchObject({ code: "WRONG_AGENT" });
    expect((await position(theirs.id)).float).toBe(0);
  });

  test("commission accrues on both directions but is not spendable until released", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    await prisma.withdrawalAgent.update({ where: { id: agent.id }, data: { commissionRate: 5 } });
    const user = await playerWithCash(0);

    await cashDeposit(agent.id, user.accountNo, 1000);

    const afterDeposit = await position(agent.id);
    expect(afterDeposit.float).toBe(4000);          // 5000 − 1000, commission excluded
    expect(afterDeposit.pendingCommission).toBe(50); // 5% of 1000

    await prisma.withdrawalRequest.create({
      data: {
        userId: user.id, amount: 200, method: "cash",
        account: agent.username, accountName: "Agent",
        publicId: "W-TEST03", withdrawalAgentId: agent.id, txnReference: "wd-test-03",
      },
    });
    await redeemCode(agent.id, "W-TEST03");

    const afterPayout = await position(agent.id);
    expect(afterPayout.float).toBe(4200);            // 4000 + 200 paid out
    expect(afterPayout.pendingCommission).toBe(60);  // 50 + 5% of 200
  });

  test("the monthly release moves commission into float, once", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 1000 });
    await prisma.withdrawalAgentTxn.create({
      data: { agentId: agent.id, type: "CASH_COMMISSION", amount: 300, note: "earned" },
    });

    process.env.CRON_SECRET = "test-cron";
    const call = () => cronPost(
      new Request("http://t/api/cron/agent-commission", {
        method: "POST", headers: { "x-cron-secret": "test-cron" },
      }) as never,
    );

    await call();
    const after = await position(agent.id);
    expect(after.float).toBe(1300);
    expect(after.pendingCommission).toBe(0);

    // A scheduler firing twice must not pay twice.
    await call();
    const again = await position(agent.id);
    expect(again.float).toBe(1300);
    expect(again.pendingCommission).toBe(0);
    expect(await prisma.withdrawalAgentTxn.count({
      where: { agentId: agent.id, type: "COMMISSION_PAYOUT" },
    })).toBe(1);
  });

  test("a cash deposit binds the player to that agent", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0 });

    await cashDeposit(agent.id, user.accountNo, 300);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.cashAgentId).toBe(agent.id);
  });

  test("a bound player cannot withdraw through a different agent", async () => {
    const mine = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const other = await makeWithdrawalAgent({ isCashAgent: true });
    const user = await makeUser({ balance: 0 });

    await cashDeposit(mine.id, user.accountNo, 500);
    // The deposit is not withdrawable until wagered, so give them clean winnings.
    await prisma.user.update({
      where: { id: user.id },
      data: { balance: 1000, depositBalance: 0 },
    });

    const refused = await requestCash(user.id, other.id, 200);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("cash withdrawals go back through them");

    const allowed = await requestCash(user.id, mine.id, 200);
    expect(allowed.status).toBe(200);
    expect(allowed.body.publicId).toMatch(/^W-/);
  });

  test("deactivating an agent frees their players to use any counter", async () => {
    const mine = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const other = await makeWithdrawalAgent({ isCashAgent: true });
    const user = await makeUser({ balance: 0 });

    await cashDeposit(mine.id, user.accountNo, 500);
    await prisma.user.update({
      where: { id: user.id },
      data: { balance: 1000, depositBalance: 0 },
    });

    // An agent who has stopped working must not strand their customers' money.
    await prisma.withdrawalAgent.update({ where: { id: mine.id }, data: { isActive: false } });

    const res = await requestCash(user.id, other.id, 200);
    expect(res.status).toBe(200);
  });

  test("the deposit turnover lock still applies to cash", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0 });

    await cashDeposit(agent.id, user.accountNo, 800);

    // Cash in, cash straight back out with no wager in between is the
    // laundering path this whole design exists to block.
    const res = await requestCash(user.id, agent.id, 800);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Only your winnings can be withdrawn");
  });
});
