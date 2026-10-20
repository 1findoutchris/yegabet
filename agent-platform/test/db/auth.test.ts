import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { loadEnv } from "../../src/config/env";
import { setFlag } from "../../src/config/featureFlags";
import { PrismaService } from "../../src/db/prisma.service";
import { Ledger } from "../../src/ledger/ledger";
import { sha256 } from "../../src/auth/sessions";
import { SIGNUP_FLAG, type BotCall, type TgUpdate } from "../../src/telegram/bot";
import { TELEGRAM_API } from "../../src/telegram/telegram.controller";
import { Hierarchy } from "../../src/users/hierarchy";
import { PHONE_KEYS } from "../keys";
import { BOT_TOKEN, BOT_USERNAME, WEBHOOK_SECRET, signInitData, signWidget } from "../telegramSign";
import { TEST_DATABASE_URL, testPrisma } from "./testDb";

jest.setTimeout(120_000);

const sent: BotCall[] = [];
let failNextReply = false;
const fakeApi = {
  call: async (c: BotCall) => {
    if (failNextReply) {
      failNextReply = false;
      throw new Error("telegram down");
    }
    sent.push(c);
  },
};

async function boot(extraEnv: Record<string, string> = {}): Promise<INestApplication> {
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...PHONE_KEYS,
    ...extraEnv,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PrismaService)
    .useValue(new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } }))
    .overrideProvider(TELEGRAM_API)
    .useValue(extraEnv.TELEGRAM_BOT_TOKEN ? fakeApi : null)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.set("trust proxy", 1);
  await app.init();
  return app;
}

const TELEGRAM_ENV = {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: BOT_USERNAME,
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  WEBAPP_URL: "https://app.example/tg",
  PUBLIC_WEB_URL: "https://site.example",
};

let app: INestApplication;
let db: PrismaClient;
let hierarchy: Hierarchy;
let ipCounter = 0;
/** A new client IP per request, so the per-IP rate limits only bite where a test wants them to. */
const ip = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const http = () => request(app.getHttpServer());
let tgId = 900_000_000;
const newTgId = () => String(++tgId);
let phoneSeq = 0;
const newPhone = () => `+25191${String(1_000_000 + ++phoneSeq).slice(-7)}`;

beforeAll(async () => {
  app = await boot(TELEGRAM_ENV);
  db = testPrisma();
  hierarchy = new Hierarchy(db, new Ledger(db));
  await setFlag(db, SIGNUP_FLAG, true, "test");
});
afterAll(async () => {
  await setFlag(db, SIGNUP_FLAG, false, "test");
  await app.close();
  await db.$disconnect();
});

const hook = (update: TgUpdate, secret = WEBHOOK_SECRET) =>
  http().post("/telegram/webhook").set("x-telegram-bot-api-secret-token", secret).send(update);

/** Runs the whole bot sign-up for a Telegram user and returns the new player id. */
async function signUpViaBot(userId: string, phone: string, start = "/start"): Promise<bigint> {
  await hook({ message: { from: { id: userId }, chat: { id: userId }, text: start } });
  await hook({
    callback_query: { id: "cb", from: { id: userId }, data: "age_yes", message: { chat: { id: userId } } },
  });
  await hook({
    message: {
      from: { id: userId },
      chat: { id: userId },
      contact: { phone_number: phone, user_id: userId },
    },
  });
  const p = await db.player.findUniqueOrThrow({ where: { telegramUserId: userId } });
  return p.id;
}

describe("webhook security", () => {
  it("refuses calls without the right secret", async () => {
    expect((await hook({}, "wrong-secret-wrong-secret")).status).toBe(401);
    expect((await http().post("/telegram/webhook").send({})).status).toBe(401);
  });

  it("answers 200 and keeps going when a reply can't be sent", async () => {
    failNextReply = true;
    const res = await hook({ message: { from: { id: "1" }, chat: { id: "1" }, text: "hello" } });
    expect(res.status).toBe(200);
  });
});

describe("sign-up through the bot, then login", () => {
  it("registers with B's referral, stores 18+, audits, and logs in from the Mini App", async () => {
    const B = await hierarchy.createAgent({ slug: `auth-b-${process.pid}`, displayName: "B" });
    const userId = newTgId();
    sent.length = 0;
    const playerId = await signUpViaBot(userId, newPhone(), `/start ${B.slug}`);

    const player = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(player.agentId).toBe(B.id);
    expect(player.ageConfirmedAt).toBeInstanceOf(Date);
    expect(sent.map((c) => c.body.text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/18 or older/),
        expect.stringMatching(/account is ready/),
      ]),
    );
    const audit = await db.auditLog.findFirst({
      where: { action: "player.registered", actorId: playerId.toString() },
    });
    expect(audit?.after).toMatchObject({ agentId: B.id.toString(), via: "telegram" });

    // Mini App login → session → /me → logout → 401.
    const login = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "player" });
    expect(login.status).toBe(200);
    expect(login.body.principal).toEqual({ kind: "player", playerId: playerId.toString() });
    expect(login.headers["set-cookie"]?.[0]).toMatch(/ap_session=.*HttpOnly/);
    const token = login.body.token as string;
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored
    expect(await db.session.count({ where: { tokenHash: sha256(token) } })).toBe(1);

    const me = await http().get("/me").set("authorization", `Bearer ${token}`);
    expect(me.body).toEqual({ kind: "player", playerId: playerId.toString() });
    const viaCookie = await http()
      .get("/me")
      .set("cookie", `ap_session=${encodeURIComponent(token)}`);
    expect(viaCookie.status).toBe(200);

    expect((await http().post("/auth/logout").set("authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await http().get("/me").set("authorization", `Bearer ${token}`)).status).toBe(401);
    expect(await db.auditLog.count({ where: { action: "auth.logout", actorId: playerId.toString() } })).toBe(
      1,
    );
  });

  it("logs in from the website widget; refuses bad signatures and missing accounts", async () => {
    const userId = newTgId();
    await signUpViaBot(userId, newPhone());
    const ok = await http()
      .post("/auth/telegram/widget")
      .set("x-forwarded-for", ip())
      .send({ ...signWidget(userId), as: "player" });
    expect(ok.status).toBe(200);

    const forged = await http()
      .post("/auth/telegram/widget")
      .set("x-forwarded-for", ip())
      .send({ ...signWidget(userId), first_name: "Mallory", as: "player" });
    expect(forged.status).toBe(403);

    const asStaff = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "staff" });
    expect(asStaff.status).toBe(403);
    expect(
      await db.auditLog.count({ where: { action: "auth.login_failed", target: `telegram:${userId}` } }),
    ).toBe(1);

    const noInitData = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ as: "player" });
    expect(noInitData.status).toBe(403);

    const badAs = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "admin" });
    expect(badAs.status).toBe(400);
  });

  it("one Telegram account as player and as owner: the role decides the permissions", async () => {
    const userId = newTgId();
    const playerId = await signUpViaBot(userId, newPhone());
    const staff = await db.staff.create({ data: { displayName: "Owner", telegramUserId: userId } });
    await db.staffRole.create({ data: { staffId: staff.id, roleKey: "owner", grantedBy: "test" } });

    const asOwner = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "staff" });
    expect(asOwner.body.principal).toEqual({ kind: "staff", staffId: staff.id.toString(), roles: ["owner"] });

    const asPlayer = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "player" });
    expect(asPlayer.body.principal).toEqual({ kind: "player", playerId: playerId.toString() });

    // Disabling the staff member ends their staff session at once.
    await db.staff.update({ where: { id: staff.id }, data: { status: "disabled" } });
    expect((await http().get("/me").set("authorization", `Bearer ${asOwner.body.token}`)).status).toBe(401);
    const again = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "staff" });
    expect(again.status).toBe(403);
  });

  it("agent members log in too, and lose access when their agent is paused", async () => {
    const agent = await hierarchy.createAgent({ slug: `auth-m-${process.pid}`, displayName: "M" });
    const userId = newTgId();
    const member = await db.agentMember.create({
      data: { agentId: agent.id, displayName: "Mo", telegramUserId: userId },
    });
    const login = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "agent_member" });
    expect(login.body.principal).toEqual({
      kind: "agent_member",
      memberId: member.id.toString(),
      agentId: agent.id.toString(),
    });
    await db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
    expect((await http().get("/me").set("authorization", `Bearer ${login.body.token}`)).status).toBe(401);
  });

  it("expired and unknown sessions don't work", async () => {
    const userId = newTgId();
    await signUpViaBot(userId, newPhone());
    const login = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "player" });
    await db.session.updateMany({
      where: { tokenHash: sha256(login.body.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await http().get("/me").set("authorization", `Bearer ${login.body.token}`)).status).toBe(401);
    expect((await http().get("/me").set("authorization", "Bearer nope")).status).toBe(401);
    expect(
      (
        await http()
          .get("/me")
          .set("authorization", `Bearer ${"x".repeat(300)}`)
      ).status,
    ).toBe(401);
    // A frozen player's session stops working too.
    const p = await db.player.findUniqueOrThrow({ where: { telegramUserId: userId } });
    const fresh = await http()
      .post("/auth/telegram/miniapp")
      .set("x-forwarded-for", ip())
      .send({ initData: signInitData({ id: userId }), as: "player" });
    await db.player.update({ where: { id: p.id }, data: { status: "frozen" } });
    expect((await http().get("/me").set("authorization", `Bearer ${fresh.body.token}`)).status).toBe(401);
  });
});

describe("Login Widget redirect mode (no eval: CSP-safe)", () => {
  const callback = (fields: Record<string, string>, as: string) =>
    http()
      .get(`/auth/telegram/widget/callback?${new URLSearchParams({ as, ...fields }).toString()}`)
      .set("x-forwarded-for", ip());

  it("signs a player in and sends them home; staff to /#/admin, agents to /#/agent", async () => {
    const userId = newTgId();
    await signUpViaBot(userId, newPhone());
    const res = await callback(signWidget(userId), "player");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/#/");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/ap_session=.*HttpOnly/);
    const cookie = (res.headers["set-cookie"]?.[0] as string).split(";")[0] as string;
    expect((await http().get("/me").set("cookie", cookie)).body.kind).toBe("player");

    const staff = await db.staff.create({ data: { displayName: "S", telegramUserId: userId } });
    await db.staffRole.create({ data: { staffId: staff.id, roleKey: "owner", grantedBy: "test" } });
    expect((await callback(signWidget(userId), "staff")).headers.location).toBe("/#/admin");
    const agent = await hierarchy.createAgent({ slug: `auth-cb-${process.pid}`, displayName: "CB" });
    await db.agentMember.create({ data: { agentId: agent.id, displayName: "m", telegramUserId: userId } });
    expect((await callback(signWidget(userId), "agent_member")).headers.location).toBe("/#/agent");
  });

  it("sends a forged or unknown login back to the login screen with the reason", async () => {
    const forged = await callback({ ...signWidget(newTgId()), first_name: "Mallory" }, "staff");
    expect(forged.status).toBe(302);
    const location = forged.headers.location as string;
    expect(location.startsWith("/?login_error=")).toBe(true);
    expect(location.endsWith("#/admin")).toBe(true);
    expect(decodeURIComponent(location)).toContain("Telegram login expired or was invalid");
    expect(forged.headers["set-cookie"]).toBeUndefined();
    const unknown = await callback(signWidget(newTgId()), "player");
    expect(decodeURIComponent(unknown.headers.location as string)).toMatch(/no active player account/);
  });
});

describe("website sign-up hand-off", () => {
  it("start → bot → status gives exactly one session", async () => {
    const C = await hierarchy.createAgent({ slug: `auth-c-${process.pid}`, displayName: "C" });
    const start = await http().post("/auth/signup/start").set("x-forwarded-for", ip()).send({ ref: C.slug });
    expect(start.status).toBe(200);
    expect(start.body.botLink).toBe(`https://t.me/${BOT_USERNAME}?start=w_${start.body.code}`);
    const code = start.body.code as string;

    expect((await http().get(`/auth/signup/status?code=${code}`)).body).toEqual({ status: "pending" });

    const userId = newTgId();
    sent.length = 0;
    const playerId = await signUpViaBot(userId, newPhone(), `/start w_${code}`);
    expect((await db.player.findUniqueOrThrow({ where: { id: playerId } })).agentId).toBe(C.id);
    expect(JSON.stringify(sent)).toContain("Continue on website");

    const done = await http().get(`/auth/signup/status?code=${code}`);
    expect(done.body).toMatchObject({
      status: "done",
      principal: { kind: "player", playerId: playerId.toString() },
    });
    expect((await http().get("/me").set("authorization", `Bearer ${done.body.token}`)).status).toBe(200);
    expect((await http().get(`/auth/signup/status?code=${code}`)).status).toBe(410); // used up
  });

  it("refuses unknown, expired and invalid codes and referrals", async () => {
    expect((await http().get("/auth/signup/status?code=nope")).status).toBe(404);
    expect((await http().get("/auth/signup/status")).status).toBe(404);
    expect((await http().get(`/auth/signup/status?code=${"x".repeat(80)}`)).status).toBe(404);
    const start = await http().post("/auth/signup/start").set("x-forwarded-for", ip()).send({});
    await db.webSignup.update({
      where: { codeHash: sha256(start.body.code) },
      data: { expiresAt: new Date(0) },
    });
    expect((await http().get(`/auth/signup/status?code=${start.body.code}`)).status).toBe(404);

    const company = await hierarchy.companyAgent();
    for (const ref of ["no-such-agent", company.slug, 42]) {
      const res = await http().post("/auth/signup/start").set("x-forwarded-for", ip()).send({ ref });
      expect(res.status).toBe(400);
    }
  });

  it("a frozen player can't pick up a finished website sign-up", async () => {
    const start = await http().post("/auth/signup/start").set("x-forwarded-for", ip()).send({});
    const userId = newTgId();
    const playerId = await signUpViaBot(userId, newPhone(), `/start w_${start.body.code}`);
    await db.player.update({ where: { id: playerId }, data: { status: "frozen" } });
    expect((await http().get(`/auth/signup/status?code=${start.body.code}`)).status).toBe(403);
  });
});

describe("rate limits", () => {
  it("the 11th login attempt from one IP within a minute gets 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await http()
        .post("/auth/telegram/miniapp")
        .set("x-forwarded-for", "203.0.113.7")
        .send({ initData: "bad", as: "player" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("audit log", () => {
  it("can't be edited or deleted", async () => {
    const row = await db.auditLog.findFirstOrThrow();
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/immutable/);
  });
});

describe("without Telegram configured", () => {
  it("auth and webhook answer 503 instead of the app failing to start", async () => {
    const bare = await boot();
    const r = request(bare.getHttpServer());
    expect((await r.post("/auth/telegram/miniapp").send({})).status).toBe(503);
    expect((await r.post("/auth/telegram/widget").send({})).status).toBe(503);
    expect((await r.get("/auth/telegram/widget/callback?as=staff")).status).toBe(503);
    expect((await r.post("/auth/signup/start").send({})).status).toBe(503);
    expect((await r.post("/telegram/webhook").send({})).status).toBe(503);
    expect((await r.get("/health")).status).toBe(200);
    await bare.close();
  });
});
