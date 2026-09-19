import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/provider/wallet/callback/route";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";

/*
 * The single highest-value route in the app.
 *
 * It settles every bet and credits every win, and it has NO session — an HMAC
 * signature is the only thing authenticating it. A replayed request that
 * credits twice, or a forged signature that gets through, is money out the door.
 *
 * Notably it needs no auth mocking at all, which makes it the cheapest
 * integration test here relative to what it protects.
 */

const SECRET = () => process.env.SILENT_API_SECRET_KEY ?? "test-silent-hmac-secret";

function callback(body: Record<string, unknown>, opts: { signature?: string } = {}) {
  // Sign the exact bytes the handler will read — it verifies over the raw body.
  const raw = JSON.stringify(body);
  const signature = opts.signature ?? createHmac("sha256", SECRET()).update(raw).digest("hex");
  return POST(req("POST", "/api/provider/wallet/callback", {
    body: raw,
    headers: { "x-signature": signature },
  }));
}

const payload = (over: Record<string, unknown> = {}) => ({
  serial_number: `sn-${Math.random().toString(36).slice(2)}`,
  member_account: "unknown_user",
  bet_amount: "0",
  win_amount: "0",
  ...over,
});

beforeAll(async () => {
  await truncateAll();
});

describe("signature", () => {
  test("rejects a wrong signature with 401", async () => {
    const { status, body } = await json(await callback(payload(), { signature: "ff".repeat(32) }));
    expect(status).toBe(401);
    expect(body.msg).toBe("Invalid Signature");
  });

  test("rejects a missing signature", async () => {
    const raw = JSON.stringify(payload());
    const res = await POST(req("POST", "/api/provider/wallet/callback", { body: raw }));
    expect(res.status).toBe(401);
  });

  test("rejects a signature over different bytes", async () => {
    // Signed one body, sent another — the classic tamper.
    const signed = createHmac("sha256", SECRET()).update(JSON.stringify(payload())).digest("hex");
    const { status } = await json(await callback(payload({ win_amount: "999999" }), { signature: signed }));
    expect(status).toBe(401);
  });

  test("accepts a correct signature", async () => {
    // Unknown user → 404 proves it got past signature verification.
    const { status } = await json(await callback(payload()));
    expect(status).toBe(404);
  });
});

describe("settlement", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a bet drains the deposit pot first and leaves withdrawable alone", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100, bonusBalance: 0 });

    const { status } = await json(await callback(payload({
      member_account: user.username, bet_amount: "40", win_amount: "0",
    })));
    expect(status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(60);
    expect(Number(after.depositBalance)).toBe(60);
    // withdrawable = balance − deposit − bonus
    expect(Number(after.balance) - Number(after.depositBalance) - Number(after.bonusBalance)).toBe(0);
  });

  test("a win lands wholly in withdrawable", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100, bonusBalance: 0 });

    await json(await callback(payload({
      member_account: user.username, bet_amount: "50", win_amount: "200",
    })));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(250);         // 100 − 50 + 200
    expect(Number(after.depositBalance)).toBe(50);   // stake drained deposit
    // The whole 200 win is cashable — this is the ONLY way funds become
    // withdrawable, there is no wagering counter.
    expect(Number(after.balance) - Number(after.depositBalance) - Number(after.bonusBalance)).toBe(200);
  });

  test("refuses a stake larger than the balance without moving money", async () => {
    const user = await makeUser({ balance: 10, depositBalance: 10 });

    const { status, body } = await json(await callback(payload({
      member_account: user.username, bet_amount: "500", win_amount: "0",
    })));

    // Deliberately HTTP 200 with code 402 — the provider's contract.
    expect(status).toBe(200);
    expect(body.code).toBe(402);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(10);
  });

  test("an unknown member_account is 404 and creates nothing", async () => {
    const { status } = await json(await callback(payload({ member_account: "ghost" })));
    expect(status).toBe(404);
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe("idempotency — the double-credit guard", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a replayed serial_number does NOT credit twice", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const body = payload({ member_account: user.username, bet_amount: "0", win_amount: "500" });

    const first = await json(await callback(body));
    expect(first.status).toBe(200);

    const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(afterFirst.balance)).toBe(600);

    // Same payload again — exactly what a provider retry looks like.
    const second = await json(await callback(body));
    expect(second.status).toBe(200);

    const afterSecond = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(afterSecond.balance)).toBe(600); // unchanged, not 1100

    // And exactly one ledger row, guarded by the unique `reference`.
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);
  });

  test("the replay still reports the current balance back to the provider", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const body = payload({ member_account: user.username, bet_amount: "0", win_amount: "50" });

    await callback(body);
    const { body: replay } = await json<{ code: number; balance: number }>(await callback(body));

    expect(replay.code).toBe(0);
    expect(replay.balance).toBe(150);
  });

  test("different serial numbers both settle", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });

    await callback(payload({ member_account: user.username, bet_amount: "0", win_amount: "10" }));
    await callback(payload({ member_account: user.username, bet_amount: "0", win_amount: "10" }));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(120);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe("loyalty points", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a stake earns points and they only ever increase", async () => {
    const user = await makeUser({ balance: 1000, depositBalance: 1000, loyaltyPoints: 0 });

    await callback(payload({ member_account: user.username, bet_amount: "100", win_amount: "0" }));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.loyaltyPoints).toBeGreaterThan(0);
    expect(after.pointsBalance).toBeGreaterThan(0);
  });
});
