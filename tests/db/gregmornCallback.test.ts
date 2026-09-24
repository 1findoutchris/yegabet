import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/provider/gregmorn/callback/route";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";

/*
 * Gregmorn seamless-wallet callback — same threat model as the Silent one:
 * no session, an HMAC signature is the only auth, and a replayed writeBet or
 * a missed rollback is money out the door.
 *
 * Differences under test: three cmds on one route, sessionid validation
 * against GameSession, and rollback REUSING the original bet's transactionId.
 */

const SECRET = () => process.env.GREGMORN_SECRET_KEY ?? "test-gregmorn-hmac-secret";
// The route rejects everything when the secret is unset — guarantee one exists.
process.env.GREGMORN_SECRET_KEY ??= "test-gregmorn-hmac-secret";

function callback(body: Record<string, unknown>, opts: { signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = opts.signature ?? createHmac("sha256", SECRET()).update(raw).digest("hex");
  return POST(req("POST", "/api/provider/gregmorn/callback", {
    body: raw,
    headers: { "x-signature": signature },
  }));
}

const txnId = () => `txn-${Math.random().toString(36).slice(2)}`;
const sessionId = () => `sess-${Math.random().toString(36).slice(2)}`;

async function makeSession(userId: string) {
  const sid = sessionId();
  await prisma.gameSession.create({ data: { sessionId: sid, userId, gameId: "black:pg:1024" } });
  return sid;
}

const payload = (over: Record<string, unknown> = {}) => ({
  cmd: "getBalance",
  login: "unknown_user",
  sessionid: sessionId(),
  ...over,
});

beforeAll(async () => {
  await truncateAll();
});

describe("signature", () => {
  test("rejects a wrong signature with 401", async () => {
    const { status, body } = await json(await callback(payload(), { signature: "ff".repeat(32) }));
    expect(status).toBe(401);
    expect(body.status).toBe("fail");
  });

  test("rejects a missing signature", async () => {
    const res = await POST(req("POST", "/api/provider/gregmorn/callback", {
      body: JSON.stringify(payload()),
    }));
    expect(res.status).toBe(401);
  });

  test("rejects a signature over different bytes", async () => {
    const signed = createHmac("sha256", SECRET()).update(JSON.stringify(payload())).digest("hex");
    const { status } = await json(await callback(payload({ win: "999999" }), { signature: signed }));
    expect(status).toBe(401);
  });

  test("accepts a correct signature", async () => {
    // Unknown user → 404 proves it got past signature verification.
    const { status } = await json(await callback(payload()));
    expect(status).toBe(404);
  });
});

describe("getBalance", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("returns the player's balance for a valid session", async () => {
    const user = await makeUser({ balance: 123.45 });
    const sid = await makeSession(user.id);

    const { status, body } = await json(await callback(
      payload({ login: user.id, sessionid: sid })
    ));
    expect(status).toBe(200);
    expect(body.status).toBe("success");
    expect(body.balance).toBe(123.45);
    expect(body.currency).toBe("ETB");
  });

  test("rejects an unknown session", async () => {
    const user = await makeUser({ balance: 100 });
    const { status, body } = await json(await callback(
      payload({ login: user.id, sessionid: "sess-never-launched" })
    ));
    expect(status).toBe(400);
    expect(body.error).toBe("session not found");
  });

  test("rejects a session belonging to another user", async () => {
    const a = await makeUser({ balance: 100 });
    const b = await makeUser({ balance: 100 });
    const sid = await makeSession(a.id);

    const { status } = await json(await callback(
      payload({ login: b.id, sessionid: sid })
    ));
    expect(status).toBe(400);
  });
});

describe("writeBet", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a bet drains the deposit pot first", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100, bonusBalance: 0 });
    const sid = await makeSession(user.id);

    const { status, body } = await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "40", win: "0", transactionId: txnId(),
    })));
    expect(status).toBe(200);
    expect(body.balance).toBe(60);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(60);
    expect(Number(after.depositBalance)).toBe(60);
  });

  test("a win lands wholly in withdrawable", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100, bonusBalance: 0 });
    const sid = await makeSession(user.id);

    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "50", win: "200", transactionId: txnId(),
    })));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(250);
    expect(Number(after.balance) - Number(after.depositBalance) - Number(after.bonusBalance)).toBe(200);
  });

  test("refuses a stake larger than the balance without moving money", async () => {
    const user = await makeUser({ balance: 10, depositBalance: 10 });
    const sid = await makeSession(user.id);

    const { status, body } = await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "500", win: "0", transactionId: txnId(),
    })));
    expect(status).toBe(400);
    expect(body.error).toBe("insufficient funds");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(10);
  });

  test("a replayed transactionId settles once", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = txnId();
    const p = payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "30", win: "0", transactionId: id,
    });

    await json(await callback(p));
    const { status, body } = await json(await callback(p));
    expect(status).toBe(200);
    expect(body.balance).toBe(70);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(70); // not 40
  });
});

describe("rollback", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("restores the stake and removes the win, once", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = txnId();

    // Round: bet 50, win 200 → balance 250
    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "50", win: "200", transactionId: id,
    })));

    // Rollback REUSES the same transactionId
    const { status, body } = await json(await callback(payload({
      cmd: "rollback", login: user.id, sessionid: sid,
      bet: "50", win: "200", transactionId: id,
    })));
    expect(status).toBe(200);
    expect(body.balance).toBe(100);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(100);

    // Replay → still 100, no double refund
    const again = await json(await callback(payload({
      cmd: "rollback", login: user.id, sessionid: sid,
      bet: "50", win: "200", transactionId: id,
    })));
    expect(again.body.balance).toBe(100);
  });

  test("rollback of an unknown transactionId is a no-op success", async () => {
    const user = await makeUser({ balance: 77 });
    const sid = await makeSession(user.id);

    const { status, body } = await json(await callback(payload({
      cmd: "rollback", login: user.id, sessionid: sid,
      bet: "10", win: "0", transactionId: txnId(),
    })));
    expect(status).toBe(200);
    expect(body.balance).toBe(77);
  });

  test("reverses the ORIGINAL round's amounts, not whatever the rollback claims", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = txnId();

    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid,
      bet: "50", win: "200", transactionId: id,
    })));

    // Rollback payload omits the win — the 200 must still come back out.
    const { body } = await json(await callback(payload({
      cmd: "rollback", login: user.id, sessionid: sid,
      bet: "50", transactionId: id,
    })));
    expect(body.balance).toBe(100);
  });

  test("reverses an agent's commission along with the round", async () => {
    const agent = await makeUser({ balance: 100, depositBalance: 100 });
    await prisma.user.update({
      where: { id: agent.id },
      data: { role: "IN_PERSON_AGENT", commissionRate: 10 },
    });
    const sid = await makeSession(agent.id);
    const id = txnId();

    await json(await callback(payload({
      cmd: "writeBet", login: agent.id, sessionid: sid, bet: "50", win: "0", transactionId: id,
    })));
    const mid = await prisma.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(Number(mid.balance)).toBe(55); // 100 − 50 + 5 commission

    const { body } = await json(await callback(payload({
      cmd: "rollback", login: agent.id, sessionid: sid, bet: "50", win: "0", transactionId: id,
    })));
    expect(body.balance).toBe(100);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(Number(after.balance)).toBe(100);
    expect(Number(after.depositBalance)).toBe(100);
  });

  test("never drives a pot negative if the winnings were already spent", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = txnId();

    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, bet: "50", win: "200", transactionId: id,
    })));
    // Player spends most of it on a later round
    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, bet: "240", win: "0", transactionId: txnId(),
    })));

    await json(await callback(payload({
      cmd: "rollback", login: user.id, sessionid: sid, bet: "50", win: "200", transactionId: id,
    })));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBeGreaterThanOrEqual(0);
    expect(Number(after.depositBalance)).toBeGreaterThanOrEqual(0);
    expect(Number(after.bonusBalance)).toBeGreaterThanOrEqual(0);
    expect(Number(after.depositBalance) + Number(after.bonusBalance)).toBeLessThanOrEqual(Number(after.balance));
  });

  test("cannot roll back another player's round", async () => {
    const victim = await makeUser({ balance: 100, depositBalance: 100 });
    const other = await makeUser({ balance: 5 });
    const vSid = await makeSession(victim.id);
    const oSid = await makeSession(other.id);
    const id = txnId();

    await json(await callback(payload({
      cmd: "writeBet", login: victim.id, sessionid: vSid,
      bet: "40", win: "0", transactionId: id,
    })));

    const { body } = await json(await callback(payload({
      cmd: "rollback", login: other.id, sessionid: oSid,
      bet: "40", win: "0", transactionId: id,
    })));
    expect(body.balance).toBe(5);

    const [v, o] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: victim.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: other.id } }),
    ]);
    expect(Number(v.balance)).toBe(60);
    expect(Number(o.balance)).toBe(5);
  });
});

describe("amount validation", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test.each([
    ["non-numeric bet", { bet: "abc", win: "0" }],
    ["negative bet", { bet: "-50", win: "0" }],
    ["negative win", { bet: "0", win: "-50" }],
  ])("rejects %s without moving money", async (_label, amounts) => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);

    const { status } = await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, transactionId: txnId(), ...amounts,
    })));
    expect(status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(100);
  });

  test("accepts numeric (not string) amounts", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);

    const { status, body } = await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, transactionId: txnId(), bet: 12.5, win: 0,
    })));
    expect(status).toBe(200);
    expect(body.balance).toBe(87.5);
  });
});

describe("reference namespace", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("a non-Gregmorn transaction with the same reference doesn't swallow the bet", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = "123456";

    // e.g. a deposit whose bank reference happens to match their txn id
    await prisma.transaction.create({
      data: {
        userId: user.id, type: "DEPOSIT", status: "COMPLETED", amount: 1,
        balanceBefore: 0, balanceAfter: 1, reference: id,
      },
    });

    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, bet: "30", win: "0", transactionId: id,
    })));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(70);
  });
});

describe("concurrency", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("parallel bets never lose an update", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        callback(payload({
          cmd: "writeBet", login: user.id, sessionid: sid, bet: "10", win: "0", transactionId: txnId(),
        })).then(json)
      )
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(0);
    expect(Number(after.depositBalance)).toBe(0);
  });

  test("parallel bets can't overdraw", async () => {
    const user = await makeUser({ balance: 50, depositBalance: 50 });
    const sid = await makeSession(user.id);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        callback(payload({
          cmd: "writeBet", login: user.id, sessionid: sid, bet: "10", win: "0", transactionId: txnId(),
        })).then(json)
      )
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(0);
  });

  test("a duplicate transactionId racing itself settles once, without a 500", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const p = payload({
      cmd: "writeBet", login: user.id, sessionid: sid, bet: "25", win: "0", transactionId: txnId(),
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => callback(p).then(json)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(75);
  });

  test("a rollback racing itself refunds once", async () => {
    const user = await makeUser({ balance: 100, depositBalance: 100 });
    const sid = await makeSession(user.id);
    const id = txnId();
    await json(await callback(payload({
      cmd: "writeBet", login: user.id, sessionid: sid, bet: "40", win: "0", transactionId: id,
    })));

    const rb = payload({
      cmd: "rollback", login: user.id, sessionid: sid, bet: "40", win: "0", transactionId: id,
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => callback(rb).then(json)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Number(after.balance)).toBe(100);
  });
});
