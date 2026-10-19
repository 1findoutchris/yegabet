import fc from "fast-check";
import type { PrismaClient } from "@prisma/client";
import { Ledger, type Account } from "../../src/ledger/ledger";
import { InsufficientFundsError } from "../../src/ledger/errors";
import type { AccountType } from "../../src/ledger/accountTypes";
import { testPrisma, uid } from "./testDb";

let db: PrismaClient;
let ledger: Ledger;

beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db);
});
afterAll(() => db.$disconnect());

jest.setTimeout(300_000);

const TYPES: AccountType[] = [
  "COMPANY_FLOAT",
  "PLAYER_WALLET",
  "PLAYER_WALLET",
  "AGENT_CASH_POSITION",
  "COMPANY_REVENUE",
];

/**
 * Random postings between random accounts with random amounts. Whatever
 * happens (some are refused for funds), after every run: Σ balances = 0, the
 * cache equals the entries, and no non-negative account is below zero. A
 * shadow model in plain bigint arithmetic must agree with the ledger exactly.
 */
it("invariants hold for random posting sequences (100 runs)", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          from: fc.integer({ min: 0, max: TYPES.length - 1 }),
          to: fc.integer({ min: 0, max: TYPES.length - 1 }),
          amount: fc.bigInt({ min: 1n, max: 50_000n }),
        }),
        { minLength: 1, maxLength: 15 },
      ),
      async (moves) => {
        const accounts: Account[] = [];
        for (const type of TYPES) {
          accounts.push(
            await ledger.openAccount({
              type,
              ownerKind: type.startsWith("PLAYER")
                ? "player"
                : type.startsWith("AGENT")
                  ? "agent"
                  : "company",
              ownerId: uid("prop"),
            }),
          );
        }
        const model = accounts.map(() => 0n);

        for (const m of moves) {
          if (m.from === m.to) continue;
          const from = accounts[m.from] as Account;
          const to = accounts[m.to] as Account;
          const wouldBe = (model[m.from] as bigint) - m.amount;
          try {
            await ledger.post({
              idempotencyKey: uid("mv"),
              reason: "property",
              entries: [{ debitAccountId: from.id, creditAccountId: to.id, amount: m.amount }],
            });
            expect(wouldBe >= 0n || from.allowNegative).toBe(true);
            model[m.from] = wouldBe;
            model[m.to] = (model[m.to] as bigint) + m.amount;
          } catch (e) {
            expect(e).toBeInstanceOf(InsufficientFundsError);
            expect(wouldBe < 0n && !from.allowNegative).toBe(true);
          }
        }

        const actual = await Promise.all(accounts.map((a) => ledger.getBalance(a.id)));
        expect(actual).toEqual(model);
        expect(actual.reduce((s, b) => s + b, 0n)).toBe(0n);
        for (const a of accounts)
          expect(await ledger.getDerivedBalance(a.id)).toBe(await ledger.getBalance(a.id));
      },
    ),
    { numRuns: 100 },
  );

  const report = await ledger.checkInvariants();
  expect(report.ok).toBe(true);
  expect(await ledger.reconcile()).toEqual([]);
});
