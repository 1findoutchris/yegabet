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
import { Ledger } from "../../src/ledger/ledger";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { WITHDRAWALS_FLAG, WithdrawalError } from "../../src/withdrawals/withdrawals";
import { withdrawalHttp } from "../../src/withdrawals/withdrawals.controller";
import { WithdrawalSlaJob } from "../../src/withdrawals/withdrawals.module";
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
  await setFlag(db, WITHDRAWALS_FLAG, true, "test");
});
afterAll(async () => {
  await setFlag(db, WITHDRAWALS_FLAG, false, "test");
  await app.close();
  await db.$disconnect();
});

const http = () => request(app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

it("runs a withdrawal end to end over HTTP", async () => {
  const ledger = new Ledger(db);
  const agent = await new Hierarchy(db, ledger).createAgent({
    slug: `http-wd-${process.pid}`,
    displayName: "W",
  });
  const m = await db.agentMember.create({ data: { agentId: agent.id, displayName: "m" } });
  const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({
    phone: "+251966000001",
    referralSlug: agent.slug,
  });
  const cash = await ledger.openAccount({
    type: "AGENT_CASH_POSITION",
    ownerKind: "agent",
    ownerId: agent.id.toString(),
  });
  const wallet = await ledger.openAccount({
    type: "PLAYER_WALLET",
    ownerKind: "player",
    ownerId: player.id.toString(),
  });
  await ledger.post({
    idempotencyKey: `http-wd-fund-${player.id}`,
    reason: "deposit",
    entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: 100_000n }],
  });
  const staff = await db.staff.create({ data: { displayName: "Owner" } });
  await db.staffRole.create({ data: { staffId: staff.id, roleKey: "owner", grantedBy: "test" } });
  const p = (await sessions.create({ kind: "player", id: player.id })).token;
  const a = (await sessions.create({ kind: "agent_member", id: m.id })).token;
  const o = (await sessions.create({ kind: "staff", id: staff.id })).token;

  const r = await http().post("/withdrawals").set(bearer(p)).send({ amount: "300", method: "telebirr" });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ status: "requested", amountSantim: "30000" });
  expect(
    (await http().post("/withdrawals").set(bearer(p)).send({ amount: "900", method: "telebirr" })).status,
  ).toBe(409);
  expect(
    (await http().post("/withdrawals").set(bearer(p)).send({ amount: "10", method: "telebirr" })).status,
  ).toBe(400);

  const queue = await http().get("/agent/withdrawals").set(bearer(a));
  expect(queue.body.find((q: { id: string }) => q.id === r.body.id)?.payTo).toBe("+251966000001");
  expect(
    (
      await http()
        .post(`/agent/withdrawals/${r.body.id}/paid`)
        .set(bearer(a))
        .send({ reference: "HTTPWD123" })
    ).body.status,
  ).toBe("paid");
  expect((await http().get("/withdrawals").set(bearer(p))).body[0]).toMatchObject({
    status: "paid",
    destination: "+251****0001",
  });
  expect((await http().post(`/withdrawals/${r.body.id}/received`).set(bearer(p))).body.status).toBe(
    "completed",
  );

  // Decline, dispute, owner actions.
  const r2 = await http().post("/withdrawals").set(bearer(p)).send({ amount: "60", method: "ebirr" });
  expect(
    (await http().post(`/agent/withdrawals/${r2.body.id}/decline`).set(bearer(a)).send({ reason: "no" })).body
      .status,
  ).toBe("declined");
  const r3 = await http().post("/withdrawals").set(bearer(p)).send({ amount: "60", method: "ebirr" });
  expect((await http().post(`/withdrawals/${r3.body.id}/cancel`).set(bearer(p))).body.status).toBe(
    "cancelled",
  );
  const r4 = await http().post("/withdrawals").set(bearer(p)).send({ amount: "60", method: "ebirr" });
  await http().post(`/agent/withdrawals/${r4.body.id}/paid`).set(bearer(a)).send({ reference: "HTTPWD456" });
  expect((await http().post(`/withdrawals/${r4.body.id}/not-received`).set(bearer(p))).body.status).toBe(
    "disputed",
  );
  expect((await http().post(`/agent/withdrawals/${r4.body.id}/complete`).set(bearer(o))).body.status).toBe(
    "completed",
  );
  const r5 = await http().post("/withdrawals").set(bearer(p)).send({ amount: "60", method: "ebirr" });
  expect(
    (await http().post(`/agent/withdrawals/${r5.body.id}/cancel`).set(bearer(o)).send({ reason: "test" }))
      .body.status,
  ).toBe("cancelled");

  // Roles and ids.
  expect((await http().post("/withdrawals").set(bearer(a)).send({})).status).toBe(403);
  expect((await http().get("/withdrawals").set(bearer(a))).status).toBe(403);
  expect((await http().post(`/agent/withdrawals/${r5.body.id}/complete`).set(bearer(a))).status).toBe(403);
  expect((await http().post("/withdrawals/abc/cancel").set(bearer(p))).status).toBe(404);
  expect((await http().post(`/withdrawals/${r.body.id}/cancel`).set(bearer(p))).status).toBe(409);

  await setFlag(db, WITHDRAWALS_FLAG, false, "test");
  expect(
    (await http().post("/withdrawals").set(bearer(p)).send({ amount: "60", method: "ebirr" })).status,
  ).toBe(503);
  await setFlag(db, WITHDRAWALS_FLAG, true, "test");
});

it("rate-limits withdrawal requests per player", async () => {
  const player = await new Players(db, new Ledger(db), PHONE_KEY_PAIR).register({ phone: "+251966000002" });
  const tok = (await sessions.create({ kind: "player", id: player.id })).token;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++)
    statuses.push((await http().post("/withdrawals").set(bearer(tok)).send({ amount: "x" })).status);
  expect(statuses[10]).toBe(429);
});

describe("pieces", () => {
  it("maps every withdrawal error to HTTP and rethrows others", () => {
    const status = (c: WithdrawalError["code"]) => {
      try {
        withdrawalHttp(new WithdrawalError(c, "x"));
      } catch (e) {
        return (e as HttpException).getStatus();
      }
    };
    const codes: WithdrawalError["code"][] = [
      "CLOSED",
      "NOT_CONFIGURED",
      "FORBIDDEN",
      "PLAYER_NOT_ALLOWED",
      "AGENT_NOT_ACTIVE",
      "NOT_FOUND",
      "DUPLICATE_REFERENCE",
      "WRONG_STATE",
      "INSUFFICIENT_FUNDS",
      "INVALID_INPUT",
      "AMOUNT_OUT_OF_RANGE",
    ];
    expect(codes.map(status)).toEqual([503, 503, 403, 403, 403, 404, 409, 409, 409, 400, 400]);
    expect(() => withdrawalHttp(new Error("raw"))).toThrow("raw");
  });

  it("the SLA job runs, logs results and failures, and stays off in tests", async () => {
    await app.get(WithdrawalSlaJob).tick();
    await new WithdrawalSlaJob(
      { runSla: () => Promise.reject(new Error("db down")) } as never,
      { NODE_ENV: "test" } as never,
    ).tick();
    await new WithdrawalSlaJob(
      { runSla: async () => ({ escalated: 1, completed: 0 }) } as never,
      { NODE_ENV: "test" } as never,
    ).tick();
    jest.useFakeTimers();
    const live = new WithdrawalSlaJob(
      { runSla: jest.fn(async () => ({ escalated: 0, completed: 0 })) } as never,
      { NODE_ENV: "production" } as never,
    );
    live.onModuleInit();
    jest.advanceTimersByTime(15 * 60 * 1000);
    live.onModuleDestroy();
    jest.useRealTimers();
  });
});
