import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { cashDeposit, reverseCashDeposit, REVERSAL_WINDOW_MS } from "@/lib/cashAgent";
import { agentPosition } from "@/lib/agentLedger";
import { makeUser, makeWithdrawalAgent, truncateAll } from "../factories";

/*
 * Cancelling a counter deposit.
 *
 * The rule being enforced is "only while the money is demonstrably untouched",
 * and the proof is `depositBalance` — a bet drains the deposit pot first, so it
 * falling below the amount means the player has played. These tests pin that
 * inference, because it is doing the work of a per-deposit audit trail that
 * does not exist.
 */

async function position(agentId: string) {
  const rows = await prisma.withdrawalAgentTxn.groupBy({
    by: ["type"], where: { agentId }, _sum: { amount: true },
  });
  return agentPosition(rows);
}

describe("cancelling a counter deposit", () => {
  beforeEach(async () => { await truncateAll(); });

  test("puts the money back on both sides", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    await prisma.withdrawalAgent.update({ where: { id: agent.id }, data: { commissionRate: 5 } });
    const user = await makeUser({ balance: 0, depositBalance: 0 });

    const { depositId } = await cashDeposit(agent.id, user.accountNo, 800);
    expect((await position(agent.id)).float).toBe(4200);
    expect((await position(agent.id)).pendingCommission).toBe(40);

    const res = await reverseCashDeposit(agent.id, depositId);
    expect(res.amount).toBe(800);

    // Agent is exactly where they started — float and commission both undone.
    const after = await position(agent.id);
    expect(after.float).toBe(5000);
    expect(after.pendingCommission).toBe(0);

    // Player is back to zero, in both the total and the locked pot.
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(u.balance)).toBe(0);
    expect(Number(u.depositBalance)).toBe(0);

    expect((await prisma.depositRequest.findUniqueOrThrow({ where: { id: depositId } })).status)
      .toBe("REVERSED");
  });

  test("cannot be cancelled twice", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0 });
    const { depositId } = await cashDeposit(agent.id, user.accountNo, 400);

    await reverseCashDeposit(agent.id, depositId);
    await expect(reverseCashDeposit(agent.id, depositId)).rejects.toMatchObject({
      code: "DEPOSIT_NOT_FOUND",
    });

    // One reversal row, so the float cannot be inflated by retrying.
    expect(await prisma.withdrawalAgentTxn.count({
      where: { agentId: agent.id, type: "CASH_REVERSAL" },
    })).toBe(1);
    expect((await position(agent.id)).float).toBe(5000);
  });

  test("refused once the player has played with the money", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0, depositBalance: 0 });
    const { depositId } = await cashDeposit(agent.id, user.accountNo, 500);

    // A bet drains the deposit pot first — 200 staked leaves 300 locked.
    await prisma.user.update({
      where: { id: user.id },
      data: { balance: 800, depositBalance: 300 },
    });

    await expect(reverseCashDeposit(agent.id, depositId)).rejects.toMatchObject({
      code: "FUNDS_SPENT",
    });

    // Nothing moved, and the deposit is still a live APPROVED row.
    expect((await position(agent.id)).float).toBe(4500);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(u.balance)).toBe(800);
    expect((await prisma.depositRequest.findUniqueOrThrow({ where: { id: depositId } })).status)
      .toBe("APPROVED");
  });

  test("refused after the window closes", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0 });
    const { depositId } = await cashDeposit(agent.id, user.accountNo, 500);

    const later = new Date(Date.now() + REVERSAL_WINDOW_MS + 1000);
    await expect(reverseCashDeposit(agent.id, depositId, later)).rejects.toMatchObject({
      code: "WINDOW_EXPIRED",
    });
    expect((await position(agent.id)).float).toBe(4500);
  });

  test("one agent cannot cancel another's deposit", async () => {
    const mine = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const theirs = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0 });
    const { depositId } = await cashDeposit(mine.id, user.accountNo, 300);

    await expect(reverseCashDeposit(theirs.id, depositId)).rejects.toMatchObject({
      code: "DEPOSIT_NOT_FOUND",
    });
    expect((await position(theirs.id)).float).toBe(5000);
    expect((await position(mine.id)).float).toBe(4700);
  });

  test("a player's other deposits are untouched by one cancellation", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0, depositBalance: 0 });

    const first = await cashDeposit(agent.id, user.accountNo, 300);
    await cashDeposit(agent.id, user.accountNo, 200);
    expect((await position(agent.id)).float).toBe(4500);

    await reverseCashDeposit(agent.id, first.depositId);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(u.balance)).toBe(200);
    expect(Number(u.depositBalance)).toBe(200);
    expect((await position(agent.id)).float).toBe(4800);
  });
});
