import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { Sessions } from "../../src/auth/sessions";
import { loadEnv } from "../../src/config/env";
import { setFlag } from "../../src/config/featureFlags";
import { PrismaService } from "../../src/db/prisma.service";
import { DEPOSITS_FLAG, DepositError } from "../../src/deposits/deposits";
import { depositHttp } from "../../src/deposits/deposits.controller";
import { DepositExpiryJob } from "../../src/deposits/deposits.module";
import { Ledger } from "../../src/ledger/ledger";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEYS, PHONE_KEY_PAIR } from "../keys";
import { TEST_DATABASE_URL, testPrisma } from "./testDb";

jest.setTimeout(120_000);

let app: INestApplication;
let db: PrismaClient;
let sessions: Sessions;

beforeAll(async () => {
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...PHONE_KEYS,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PrismaService)
    .useValue(new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } }))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = testPrisma();
  sessions = new Sessions(db, 3_600_000);
  await setFlag(db, DEPOSITS_FLAG, true, "test");
});
afterAll(async () => {
  await setFlag(db, DEPOSITS_FLAG, false, "test");
  await app.close();
  await db.$disconnect();
});

const http = () => request(app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

it("runs a deposit end to end over HTTP", async () => {
  const ledger = new Ledger(db);
  const agent = await new Hierarchy(db, ledger).createAgent({
    slug: `http-dep-${process.pid}`,
    displayName: "H",
  });
  const m = await db.agentMember.create({ data: { agentId: agent.id, displayName: "m" } });
  const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({
    phone: "+251944000001",
    referralSlug: agent.slug,
  });
  const staff = await db.staff.create({ data: { displayName: "Owner" } });
  await db.staffRole.create({ data: { staffId: staff.id, roleKey: "owner", grantedBy: "test" } });
  const agentTok = (await sessions.create({ kind: "agent_member", id: m.id })).token;
  const playerTok = (await sessions.create({ kind: "player", id: player.id })).token;
  const ownerTok = (await sessions.create({ kind: "staff", id: staff.id })).token;

  // The agent adds their own Telebirr number.
  const added = await http()
    .post("/agent/payment-accounts")
    .set(bearer(agentTok))
    .send({ method: "telebirr", accountName: "Agent H", accountNumber: "0944123456" });
  expect(added.status).toBe(201);
  expect((await http().get("/agent/payment-accounts").set(bearer(agentTok))).body).toHaveLength(1);

  // The player sees it and deposits.
  const accounts = await http().get("/deposits/accounts").set(bearer(playerTok));
  expect(accounts.body).toEqual([
    { id: added.body.id, method: "telebirr", accountName: "Agent H", accountNumber: "0944123456" },
  ]);
  const sub = await http()
    .post("/deposits")
    .set(bearer(playerTok))
    .send({ paymentAccountId: added.body.id, amount: "250", reference: "HTTPREF7777" });
  expect(sub.status).toBe(201);
  expect(sub.body).toMatchObject({ status: "pending", amountSantim: "25000" });
  expect(
    (
      await http()
        .post("/deposits")
        .set(bearer(playerTok))
        .send({ paymentAccountId: added.body.id, amount: "250", reference: "httpref 7777" })
    ).status,
  ).toBe(409);
  expect(
    (
      await http()
        .post("/deposits")
        .set(bearer(playerTok))
        .send({ paymentAccountId: added.body.id, amount: "1", reference: "HTTPREF8888" })
    ).status,
  ).toBe(400);

  // The player sees it masked; the agent sees the full reference.
  expect((await http().get("/deposits").set(bearer(playerTok))).body[0].reference).toBe("****7777");
  const queue = await http().get("/agent/deposits?status=pending").set(bearer(agentTok));
  expect(queue.body.map((q: { reference: string }) => q.reference)).toContain("HTTPREF7777");

  // Confirm; a second reject is a conflict; reject without a reason is a 400.
  expect((await http().post(`/agent/deposits/${sub.body.id}/confirm`).set(bearer(agentTok))).body).toEqual({
    id: sub.body.id,
    status: "confirmed",
  });
  expect(
    (await http().post(`/agent/deposits/${sub.body.id}/reject`).set(bearer(agentTok)).send({ reason: "x" }))
      .status,
  ).toBe(409);
  const d2 = await http()
    .post("/deposits")
    .set(bearer(playerTok))
    .send({ paymentAccountId: added.body.id, amount: "20", reference: "HTTPREF9999" });
  expect(
    (await http().post(`/agent/deposits/${d2.body.id}/reject`).set(bearer(agentTok)).send({})).status,
  ).toBe(400);
  // The owner overrides.
  expect(
    (await http().post(`/agent/deposits/${d2.body.id}/reject`).set(bearer(ownerTok)).send({ reason: "fake" }))
      .body.status,
  ).toBe("rejected");

  // Wrong roles and bad ids.
  expect((await http().get("/deposits").set(bearer(agentTok))).status).toBe(403);
  expect((await http().get("/agent/deposits").set(bearer(playerTok))).status).toBe(403);
  expect((await http().post("/agent/deposits/abc/confirm").set(bearer(agentTok))).status).toBe(404);
  expect((await http().post("/agent/payment-accounts/xyz/deactivate").set(bearer(agentTok))).status).toBe(
    404,
  );
  expect(
    (await http().post(`/agent/payment-accounts/${added.body.id}/deactivate`).set(bearer(agentTok))).body,
  ).toEqual({ ok: true });
  expect((await http().get("/deposits")).status).toBe(401);

  // Paused agent: the player is told why.
  await db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
  expect((await http().get("/deposits/accounts").set(bearer(playerTok))).status).toBe(403);

  // Closed: 503.
  await setFlag(db, DEPOSITS_FLAG, false, "test");
  expect((await http().post("/deposits").set(bearer(playerTok)).send({})).status).toBe(503);
  await setFlag(db, DEPOSITS_FLAG, true, "test");
});

it("rate-limits deposit submissions per player", async () => {
  const ledger = new Ledger(db);
  const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({ phone: "+251944000002" });
  const tok = (await sessions.create({ kind: "player", id: player.id })).token;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++)
    statuses.push((await http().post("/deposits").set(bearer(tok)).send({ amount: "x" })).status);
  expect(statuses[10]).toBe(429);
});

describe("pieces", () => {
  it("maps every deposit error to HTTP and rethrows others", () => {
    const status = (code: DepositError["code"]) => {
      try {
        depositHttp(new DepositError(code, "x"));
      } catch (e) {
        return (e as HttpException).getStatus();
      }
    };
    expect(
      [
        "CLOSED",
        "NOT_CONFIGURED",
        "FORBIDDEN",
        "PLAYER_NOT_ALLOWED",
        "AGENT_NOT_ACTIVE",
        "NOT_FOUND",
        "DUPLICATE_REFERENCE",
        "ALREADY_DECIDED",
        "ACCOUNT_TAKEN",
        "INVALID_INPUT",
        "AMOUNT_OUT_OF_RANGE",
        "ACCOUNT_NOT_AVAILABLE",
      ].map((c) => status(c as DepositError["code"])),
    ).toEqual([503, 503, 403, 403, 403, 404, 409, 409, 409, 400, 400, 400]);
    expect(() => depositHttp(new Error("raw"))).toThrow("raw");
  });

  it("the expiry job runs, logs failures, and stays off in tests", async () => {
    const job = app.get(DepositExpiryJob);
    await job.tick();
    const failing = new DepositExpiryJob(
      { expireStale: () => Promise.reject(new Error("db down")) } as never,
      {
        NODE_ENV: "test",
      } as never,
    );
    await failing.tick(); // logs, doesn't throw
    const counting = new DepositExpiryJob(
      { expireStale: async () => 2 } as never,
      { NODE_ENV: "test" } as never,
    );
    await counting.tick();

    jest.useFakeTimers();
    const live = new DepositExpiryJob(
      { expireStale: jest.fn(async () => 0) } as never,
      { NODE_ENV: "production" } as never,
    );
    live.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);
    live.onModuleDestroy();
    jest.useRealTimers();
  });
});
