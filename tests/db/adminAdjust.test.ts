import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as adminUser } from "@/app/api/admin/users/[id]/route";
import { GET as account } from "@/app/api/user/account/route";
import { makeUser, truncateAll } from "../factories";
import { asUser } from "../helpers/session";
import { adminAuth } from "../helpers/auth";
import { json, params, req } from "../helpers/req";

/*
 * An admin balance deduction must not appear in the player's own history.
 *
 * The deduction is stored as a WITHDRAWAL transaction (BONUS is taken for
 * credits), and /api/user/account lists DEPOSIT + WITHDRAWAL — so left
 * unfiltered the player sees a withdrawal they never requested and reads it as
 * money leaving their account. The row itself has to stay: admin reports and the
 * ledger both read it.
 */

interface AccountBody {
  balance: number;
  transactions: Array<{ type: string; amount: number }>;
}

const adjust = async (userId: string, amount: number) => {
  const auth = await adminAuth();
  return adminUser(
    req("POST", `/api/admin/users/${userId}`, {
      ...auth,
      body: { action: "adjust", amount, bucket: "withdrawable", note: "test" },
    }),
    params({ id: userId }),
  );
};

describe("admin balance adjustment visibility", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a deduction is hidden from the player but still recorded", async () => {
    const user = await makeUser({ balance: 500 });
    asUser(user);

    expect((await adjust(user.id, -120)).status).toBe(200);

    // Recorded in the ledger for reports/audit.
    const ledger = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("WITHDRAWAL");
    expect(Number(ledger[0].amount)).toBe(120);
    expect(ledger[0].reference).toMatch(/^admin-adj-/);

    // Invisible to the player, though the balance does drop.
    const { body } = await json<AccountBody>(await account());
    expect(body.transactions).toHaveLength(0);
    expect(body.balance).toBe(380);
  });

  test("a real withdrawal is still listed", async () => {
    const user = await makeUser({ balance: 500 });
    asUser(user);

    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "WITHDRAWAL",
        status: "PENDING",
        amount: 200,
        balanceBefore: 500,
        balanceAfter: 300,
        reference: "wd-real-1",
      },
    });

    const { body } = await json<AccountBody>(await account());
    expect(body.transactions).toEqual([
      expect.objectContaining({ type: "WITHDRAWAL", amount: 200 }),
    ]);
  });

  test("rows whose metadata has no `kind` key survive the filter", async () => {
    // Guards the null trap: the equivalent JSON filter
    // (NOT metadata.path(["kind"]).equals "admin_adjust") drops these too,
    // because metadata->'kind' is NULL and NOT NULL is not true. That emptied
    // every player's history.
    const user = await makeUser({ balance: 500 });
    asUser(user);

    await prisma.transaction.create({
      data: {
        userId: user.id, type: "DEPOSIT", status: "COMPLETED", amount: 50,
        balanceBefore: 450, balanceAfter: 500, reference: "dep-no-kind",
        metadata: { method: "telebirr" },
      },
    });
    await prisma.transaction.create({
      data: {
        userId: user.id, type: "DEPOSIT", status: "COMPLETED", amount: 60,
        balanceBefore: 390, balanceAfter: 450, reference: "dep-null-meta",
      },
    });

    const { body } = await json<AccountBody>(await account());
    expect(body.transactions.map((t) => t.amount).sort()).toEqual([50, 60]);
  });
});

