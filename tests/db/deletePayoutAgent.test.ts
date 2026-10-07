import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { DELETE } from "@/app/api/admin/payout-agents/[id]/route";
import { makeUser, makeWithdrawalAgent, truncateAll } from "../factories";
import { adminAuth } from "../helpers/auth";
import { json, params, req } from "../helpers/req";

/*
 * Deleting a payout / cash agent: allowed with history once their money is
 * settled; refused while anything is owed, held or in flight.
 */

async function del(id: string) {
  const auth = await adminAuth();
  return json<{ error?: string }>(await DELETE(req("DELETE", `/api/admin/payout-agents/${id}`, auth), params({ id })));
}

const ledger = (agentId: string, type: string, amount: number) =>
  prisma.withdrawalAgentTxn.create({ data: { agentId, type, amount } });

async function withdrawal(userId: string, agentId: string, status: string) {
  return prisma.withdrawalRequest.create({
    data: { userId, withdrawalAgentId: agentId, amount: 100, method: "telebirr", account: "0911", accountName: "P", status },
  });
}

beforeAll(async () => {
  await truncateAll();
});

describe("DELETE /api/admin/payout-agents/[id]", () => {
  test("a settled agent with history is deleted; players' withdrawals are kept, unassigned", async () => {
    const agent = await makeWithdrawalAgent();
    const player = await makeUser();
    await prisma.user.update({ where: { id: player.id }, data: { cashAgentId: agent.id } });
    const w = await withdrawal(player.id, agent.id, "PAID");
    await ledger(agent.id, "PAYOUT", 100);
    await ledger(agent.id, "COMMISSION", 2);
    await ledger(agent.id, "SETTLEMENT", 102);
    await prisma.agentPayoutRequest.create({
      data: { agentId: agent.id, amount: 102, method: "telebirr", account: "0911", accountName: "A", status: "PAID" },
    });

    const { status, body } = await del(agent.id);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await prisma.withdrawalAgent.findUnique({ where: { id: agent.id } })).toBeNull();
    expect(await prisma.withdrawalAgentTxn.count({ where: { agentId: agent.id } })).toBe(0);
    const kept = await prisma.withdrawalRequest.findUnique({ where: { id: w.id } });
    expect(kept?.status).toBe("PAID");
    expect(kept?.withdrawalAgentId).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: player.id } }))?.cashAgentId).toBeNull();
  });

  test("refused while the platform still owes them", async () => {
    const agent = await makeWithdrawalAgent();
    await ledger(agent.id, "PAYOUT", 50);
    const { status, body } = await del(agent.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/owes this agent ETB 50\.00/);
  });

  test("refused while a cash agent holds float", async () => {
    const agent = await makeWithdrawalAgent({ isCashAgent: true, float: 300 });
    const { status, body } = await del(agent.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/float/);
  });

  test("refused while a withdrawal is still assigned and open", async () => {
    const agent = await makeWithdrawalAgent();
    const player = await makeUser();
    await withdrawal(player.id, agent.id, "PROCESSING");
    const { status, body } = await del(agent.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/still assigned/);
  });

  test("refused while a settlement request is pending", async () => {
    const agent = await makeWithdrawalAgent();
    await prisma.agentPayoutRequest.create({
      data: { agentId: agent.id, amount: 10, method: "telebirr", account: "0911", accountName: "A" },
    });
    const { status, body } = await del(agent.id);
    expect(status).toBe(400);
    expect(body.error).toMatch(/settlement request/);
  });

  test("an agent with no history is deleted", async () => {
    const agent = await makeWithdrawalAgent();
    expect((await del(agent.id)).status).toBe(200);
  });

  test("404s on an unknown id", async () => {
    expect((await del("nope")).status).toBe(404);
  });
});
