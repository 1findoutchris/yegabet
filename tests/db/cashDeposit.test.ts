import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { cashDeposit, CashError } from "@/lib/cashAgent";
import { agentPosition } from "@/lib/agentLedger";
import { makeUser, makeWithdrawalAgent, truncateAll } from "../factories";

/*
 * The counter deposit moves money in two places at once — an agent's float down
 * and a player's balance up — across a boundary that isn't obviously atomic:
 * the float row is written by a callback running inside approveDeposit's own
 * transaction. A DB test is the only thing that proves the two really commit
 * together, which is why this isn't a unit check.
 *
 * The load-bearing assertion is `depositBalance`. Cash in and cash out with no
 * wager in between is a laundering rail; the only thing preventing it is the
 * deposit landing in the non-withdrawable pot, exactly like an SMS deposit.
 */

async function floatOf(agentId: string) {
  const rows = await prisma.withdrawalAgentTxn.groupBy({
    by: ["type"], where: { agentId }, _sum: { amount: true },
  });
  return agentPosition(rows).float;
}

describe("cash agent counter deposit", () => {
  beforeEach(async () => { await truncateAll(); });

  test("credits the player and debits the agent's float together", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0, depositBalance: 0 });

    const res = await cashDeposit(agent.id, user.accountNo, 800);

    expect(res.float).toBe(4200);
    expect(await floatOf(agent.id)).toBe(4200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(800);
    // The AML lock: playable immediately, withdrawable only after a wager.
    expect(Number(after.depositBalance)).toBe(800);

    const txn = await prisma.transaction.findFirstOrThrow({
      where: { userId: user.id, type: "DEPOSIT" },
    });
    expect(txn.status).toBe("COMPLETED");

    const req = await prisma.depositRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(req.status).toBe("APPROVED");
    expect(req.method).toBe("cash");

    const ledger = await prisma.withdrawalAgentTxn.findFirstOrThrow({
      where: { agentId: agent.id, type: "CASH_DEPOSIT" },
    });
    expect(Number(ledger.amount)).toBe(800);
  });

  test("a deposit larger than the float credits nobody", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 100 });
    const user = await makeUser({ balance: 0 });

    await expect(cashDeposit(agent.id, user.accountNo, 500)).rejects.toThrow(CashError);

    // Nothing moved on either side.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(0);
    expect(await floatOf(agent.id)).toBe(100);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.withdrawalAgentTxn.count({ where: { type: "CASH_DEPOSIT" } })).toBe(0);

    // And the request doesn't linger in the admin's PENDING queue.
    const req = await prisma.depositRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(req.status).toBe("REJECTED");
  });

  test("float is spent down across successive deposits, then runs out", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 1000 });
    const a = await makeUser({ balance: 0 });
    const b = await makeUser({ balance: 0 });

    await cashDeposit(agent.id, a.accountNo, 600);
    expect(await floatOf(agent.id)).toBe(400);

    // 500 > the 400 left — the second customer is refused even though the first
    // succeeded, which is the whole point of a prepaid float.
    await expect(cashDeposit(agent.id, b.accountNo, 500)).rejects.toThrow(CashError);
    expect(await floatOf(agent.id)).toBe(400);

    await cashDeposit(agent.id, b.accountNo, 400);
    expect(await floatOf(agent.id)).toBe(0);
  });

  test("a payout-only agent cannot take counter deposits", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: false, float: 5000 });
    const user = await makeUser({ balance: 0 });

    await expect(cashDeposit(agent.id, user.accountNo, 100)).rejects.toMatchObject({
      code: "NOT_CASH_AGENT",
    });
    expect(await prisma.transaction.count()).toBe(0);
  });

  test("a deactivated agent cannot take counter deposits", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, isActive: false, float: 5000 });
    const user = await makeUser({ balance: 0 });

    await expect(cashDeposit(agent.id, user.accountNo, 100)).rejects.toMatchObject({
      code: "NOT_CASH_AGENT",
    });
  });

  test("a banned player cannot be credited", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    const user = await makeUser({ balance: 0, isActive: false });

    await expect(cashDeposit(agent.id, user.accountNo, 100)).rejects.toMatchObject({
      code: "USER_INACTIVE",
    });
    expect(await floatOf(agent.id)).toBe(5000);
  });

  test("the float debit does not disturb what the payout rail is owed", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 5000 });
    await prisma.withdrawalAgentTxn.create({
      data: { agentId: agent.id, type: "PAYOUT", amount: 700, note: "earlier payout" },
    });
    const user = await makeUser({ balance: 0 });

    await cashDeposit(agent.id, user.accountNo, 1000);

    const rows = await prisma.withdrawalAgentTxn.groupBy({
      by: ["type"], where: { agentId: agent.id }, _sum: { amount: true },
    });
    const pos = agentPosition(rows);
    expect(pos.float).toBe(4000);
    expect(pos.outstanding).toBe(700);
  });
});
