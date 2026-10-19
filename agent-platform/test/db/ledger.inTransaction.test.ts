import type { PrismaClient } from "@prisma/client";
import { Ledger } from "../../src/ledger/ledger";
import { InsufficientFundsError } from "../../src/ledger/errors";
import { testPrisma, uid } from "./testDb";

let db: PrismaClient;
let ledger: Ledger;
beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db);
});
afterAll(async () => {
  expect((await ledger.checkInvariants()).ok).toBe(true);
  await db.$disconnect();
});

async function pair() {
  const cash = await ledger.openAccount({
    type: "AGENT_CASH_POSITION",
    ownerKind: "agent",
    ownerId: uid("a"),
  });
  const wallet = await ledger.openAccount({ type: "PLAYER_WALLET", ownerKind: "player", ownerId: uid("p") });
  return { cash, wallet };
}

describe("postInTransaction", () => {
  it("commits with the caller's transaction, and replays on retry", async () => {
    const { cash, wallet } = await pair();
    const req = {
      idempotencyKey: uid("dep"),
      reason: "deposit",
      entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: 5_000n }],
    };
    const first = await db.$transaction((tx) => ledger.postInTransaction(tx, req));
    expect(first.replayed).toBe(false);
    const again = await db.$transaction((tx) => ledger.postInTransaction(tx, req));
    expect(again).toMatchObject({ replayed: true, transaction: { id: first.transaction.id } });
    expect(await ledger.getBalance(wallet.id)).toBe(5_000n);
  });

  it("rolls the money back when the caller's transaction fails afterwards", async () => {
    const { cash, wallet } = await pair();
    const key = uid("dep");
    await expect(
      db.$transaction(async (tx) => {
        await ledger.postInTransaction(tx, {
          idempotencyKey: key,
          reason: "deposit",
          entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: 700n }],
        });
        throw new Error("caller's own step failed");
      }),
    ).rejects.toThrow("caller's own step failed");
    expect(await ledger.getBalance(wallet.id)).toBe(0n);
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("refuses an overdraft exactly like post()", async () => {
    const { wallet } = await pair();
    const revenue = await ledger.openAccount({
      type: "COMPANY_REVENUE",
      ownerKind: "company",
      ownerId: uid("r"),
    });
    await expect(
      db.$transaction((tx) =>
        ledger.postInTransaction(tx, {
          idempotencyKey: uid("x"),
          reason: "bet",
          entries: [{ debitAccountId: wallet.id, creditAccountId: revenue.id, amount: 1n }],
        }),
      ),
    ).rejects.toThrow(InsufficientFundsError);
  });
});
