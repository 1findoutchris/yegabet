import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { Admin, AdminError, LAUNCH_FLAGS } from "../../src/admin/admin";
import { PublicController, adminHttp } from "../../src/admin/admin.controller";
import { AppModule } from "../../src/app.module";
import type { Principal } from "../../src/auth/rbac";
import { Sessions } from "../../src/auth/sessions";
import { loadEnv } from "../../src/config/env";
import { setFlag } from "../../src/config/featureFlags";
import { PrismaService } from "../../src/db/prisma.service";
import { Ledger } from "../../src/ledger/ledger";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEYS, PHONE_KEY_PAIR } from "../keys";
import { TEST_DATABASE_URL, testPrisma } from "./testDb";

jest.setTimeout(120_000);

let app: INestApplication;
let db: PrismaClient;
let ownerTok: string, supportTok: string, memberTok: string, playerTok: string;
let ownerId: bigint;
const n = `${process.pid}`;

beforeAll(async () => {
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...PHONE_KEYS,
    TELEGRAM_BOT_USERNAME: "yegabettingbot",
    PLATFORM_DOMAIN: "yega.bet",
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PrismaService)
    .useValue(new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } }))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = testPrisma();
  const sessions = new Sessions(db, 3_600_000);
  const o = await db.staff.create({ data: { displayName: "Owner", telegramUserId: `7${n}01` } });
  ownerId = o.id;
  await db.staffRole.create({ data: { staffId: o.id, roleKey: "owner", grantedBy: "test" } });
  const s = await db.staff.create({ data: { displayName: "Support" } });
  await db.staffRole.create({ data: { staffId: s.id, roleKey: "support", grantedBy: "test" } });
  ownerTok = (await sessions.create({ kind: "staff", id: o.id })).token;
  supportTok = (await sessions.create({ kind: "staff", id: s.id })).token;
  const ledger = new Ledger(db);
  const a = await new Hierarchy(db, ledger).createAgent({ slug: `adm-m-${n}`, displayName: "M" });
  const m = await db.agentMember.create({ data: { agentId: a.id, displayName: "m" } });
  memberTok = (await sessions.create({ kind: "agent_member", id: m.id })).token;
  const p = await new Players(db, ledger, PHONE_KEY_PAIR).register({ phone: "+251999000001" });
  playerTok = (await sessions.create({ kind: "player", id: p.id })).token;
});
afterAll(async () => {
  for (const f of LAUNCH_FLAGS) await setFlag(db, f, false, "test");
  await app.close();
  await db.$disconnect();
});

const http = () => request(app.getHttpServer());
const as = (t: string) => ({ authorization: `Bearer ${t}` });

describe("agents", () => {
  it("the owner builds a tree with referral links; bad input and duplicates are refused", async () => {
    const top = await http()
      .post("/admin/agents")
      .set(as(ownerTok))
      .send({ slug: `adm-top-${n}`, displayName: "Top" });
    expect(top.status).toBe(201);
    expect(top.body).toMatchObject({ slug: `adm-top-${n}`, parentId: null, depth: 0, status: "active" });
    expect(top.body.links).toEqual({
      telegram: `https://t.me/yegabettingbot?start=adm-top-${n}`,
      website: `https://yega.bet/?ref=adm-top-${n}`,
    });
    const child = await http()
      .post("/admin/agents")
      .set(as(ownerTok))
      .send({ slug: `adm-kid-${n}`, displayName: "Kid", parentId: top.body.id });
    expect(child.body).toMatchObject({ parentId: top.body.id, depth: 1 });

    expect(
      (
        await http()
          .post("/admin/agents")
          .set(as(ownerTok))
          .send({ slug: `adm-top-${n}`, displayName: "Again" })
      ).status,
    ).toBe(409);
    expect(
      (await http().post("/admin/agents").set(as(ownerTok)).send({ slug: "Bad Slug", displayName: "X" }))
        .status,
    ).toBe(400);
    expect(
      (
        await http()
          .post("/admin/agents")
          .set(as(ownerTok))
          .send({ slug: `adm-x-${n}`, displayName: "X", parentId: "abc" })
      ).status,
    ).toBe(400);
    expect(
      (
        await http()
          .post("/admin/agents")
          .set(as(ownerTok))
          .send({ slug: `adm-x-${n}`, displayName: "X", parentId: "999999999" })
      ).status,
    ).toBe(400);
    expect((await http().post("/admin/agents").set(as(ownerTok)).send({})).status).toBe(400);
    expect(
      (
        await http()
          .post("/admin/agents")
          .set(as(supportTok))
          .send({ slug: `adm-y-${n}`, displayName: "Y" })
      ).status,
    ).toBe(403);

    const list = await http().get(`/admin/agents?search=adm-kid-${n}`).set(as(supportTok));
    expect(list.body).toEqual([
      expect.objectContaining({ slug: `adm-kid-${n}`, parentSlug: `adm-top-${n}`, players: 0, members: 0 }),
    ]);
    expect(
      (await http().get("/admin/agents?status=closed").set(as(ownerTok))).body.every(
        (a: { status: string }) => a.status === "closed",
      ),
    ).toBe(true);
    expect(
      (await http().get("/admin/agents").set(as(ownerTok))).body.some(
        (a: { isCompany: boolean; parentSlug: null }) => a.isCompany && a.parentSlug === null,
      ),
    ).toBe(true);
    expect(
      await db.auditLog.count({ where: { action: "agent.created", target: `agent:${top.body.id}` } }),
    ).toBe(1);
  });

  it("pauses, closes and reopens agents; the company agent stays active", async () => {
    const a = (
      await http()
        .post("/admin/agents")
        .set(as(ownerTok))
        .send({ slug: `adm-st-${n}`, displayName: "St" })
    ).body;
    const status = (id: string, s: unknown) =>
      http().post(`/admin/agents/${id}/status`).set(as(ownerTok)).send({ status: s });
    expect((await status(a.id, "paused")).body.status).toBe("paused");
    expect((await status(a.id, "active")).body.status).toBe("active");
    expect((await status(a.id, "deleted")).status).toBe(400);
    expect((await status("999999999", "paused")).status).toBe(404);
    expect((await status("xyz", "paused")).status).toBe(404);
    const company = await db.agent.findFirstOrThrow({ where: { isCompany: true } });
    expect((await status(company.id.toString(), "closed")).status).toBe(403);
    expect((await status(company.id.toString(), "active")).status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "agent.status", target: `agent:${a.id}` },
      orderBy: { id: "asc" },
    });
    expect(audit).toMatchObject({ before: { status: "active" }, after: { status: "paused" } });
  });
});

describe("members", () => {
  it("adds the people who run an agent, by Telegram id; one agent per Telegram account", async () => {
    const a = (
      await http()
        .post("/admin/agents")
        .set(as(ownerTok))
        .send({ slug: `adm-mm-${n}`, displayName: "MM" })
    ).body;
    const add = (body: object, agentId = a.id) =>
      http().post(`/admin/agents/${agentId}/members`).set(as(ownerTok)).send(body);
    const m = await add({ telegramUserId: `8${n}02`, displayName: "Abebe" });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ agentId: a.id, telegramUserId: `8${n}02`, status: "active" });
    expect((await add({ telegramUserId: Number(`8${n}02`), displayName: "Again" })).status).toBe(409);
    expect((await add({ telegramUserId: "abc", displayName: "X" })).status).toBe(400);
    expect((await add({ displayName: "X" })).status).toBe(400);
    expect((await add({ telegramUserId: `8${n}03`, displayName: 12345 })).status).toBe(400);
    expect((await add({ telegramUserId: `8${n}03`, displayName: "X" })).status).toBe(400); // name too short
    expect((await add({ telegramUserId: `8${n}03`, displayName: "Kebede" }, "999999999")).status).toBe(404);
    expect((await http().get(`/admin/agents/${a.id}/members`).set(as(supportTok))).body).toHaveLength(1);

    const ms = (s: unknown, id = m.body.id) =>
      http().post(`/admin/members/${id}/status`).set(as(ownerTok)).send({ status: s });
    expect((await ms("disabled")).body.status).toBe("disabled");
    expect((await ms("gone")).status).toBe(400);
    expect((await ms("active", "999999999")).status).toBe(404);

    await http().post(`/admin/agents/${a.id}/status`).set(as(ownerTok)).send({ status: "closed" });
    expect((await add({ telegramUserId: `8${n}04`, displayName: "Kebede" })).status).toBe(404); // closed agent
  });
});

describe("staff", () => {
  it("adds staff and roles idempotently, and never disables the last owner", async () => {
    const add = (body: object) => http().post("/admin/staff").set(as(ownerTok)).send(body);
    const fin = await add({ telegramUserId: `9${n}05`, displayName: "Finance", role: "finance" });
    expect(fin.status).toBe(201);
    expect(fin.body).toMatchObject({ roles: ["finance"], status: "active" });
    expect(
      (await add({ telegramUserId: `9${n}05`, displayName: "Finance", role: "support" })).body.roles.sort(),
    ).toEqual(["finance", "support"]);
    expect(
      (await add({ telegramUserId: `9${n}05`, displayName: "Finance", role: "finance" })).body.roles,
    ).toHaveLength(2);
    expect((await add({ telegramUserId: `9${n}06`, displayName: "X Y", role: "king" })).status).toBe(400);
    expect((await http().get("/admin/staff").set(as(ownerTok))).body.length).toBeGreaterThanOrEqual(2);
    expect((await http().get("/admin/staff").set(as(supportTok))).status).toBe(403);

    const st = (id: string, s: unknown) =>
      http().post(`/admin/staff/${id}/status`).set(as(ownerTok)).send({ status: s });
    expect((await st(fin.body.id, "disabled")).body.status).toBe("disabled");
    expect((await st(fin.body.id, "x")).status).toBe(400);
    expect((await st("999999999", "disabled")).status).toBe(404);

    // Other owners from other test files may exist: make this one the only active owner.
    await db.staff.updateMany({
      where: { id: { not: ownerId }, roles: { some: { roleKey: "owner" } } },
      data: { status: "disabled" },
    });
    expect((await st(ownerId.toString(), "disabled")).status).toBe(403);
    const second = await add({ telegramUserId: `9${n}07`, displayName: "Owner Two", role: "owner" });
    expect((await st(second.body.id, "disabled")).status).toBe(200); // not the last one
  });
});

describe("launch switches", () => {
  it("are listed and switched by the owner, audited, and refused for unknown keys", async () => {
    for (const f of LAUNCH_FLAGS) await setFlag(db, f, false, "test");
    expect((await http().get("/admin/flags").set(as(ownerTok))).body).toEqual({
      "signup.open": false,
      "deposits.open": false,
      "withdrawals.open": false,
      "games.open": false,
    });
    const on = await http().post("/admin/flags").set(as(ownerTok)).send({ key: "games.open", enabled: true });
    expect(on.body["games.open"]).toBe(true);
    expect(
      (await http().post("/admin/flags").set(as(ownerTok)).send({ key: "everything.open", enabled: true }))
        .status,
    ).toBe(400);
    expect(
      (await http().post("/admin/flags").set(as(ownerTok)).send({ key: "games.open", enabled: "yes" }))
        .status,
    ).toBe(400);
    expect(
      (await http().post("/admin/flags").set(as(memberTok)).send({ key: "games.open", enabled: false }))
        .status,
    ).toBe(403);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "flag.changed", target: "flag:games.open" },
      orderBy: { id: "desc" },
    });
    expect(audit).toMatchObject({ before: { enabled: false }, after: { enabled: true } });
  });
});

describe("public info and wallet", () => {
  it("tells the screens the brand and bot, and a player their balances", async () => {
    expect((await http().get("/public/info")).body).toEqual({
      name: "Platform",
      domain: "yega.bet",
      botUsername: "yegabettingbot",
      webappUrl: null,
    });
    expect((await http().get("/me/wallet").set(as(playerTok))).body).toEqual({
      availableSantim: "0",
      heldSantim: "0",
    });
    expect((await http().get("/me/wallet").set(as(memberTok))).status).toBe(403);
    expect((await http().get("/me/wallet")).status).toBe(401);
    const bare = new PublicController(
      db as never,
      { PLATFORM_NAME: "YegaBet", PLATFORM_DOMAIN: "yega.bet", WEBAPP_URL: "https://yega.bet/" } as never,
    );
    expect(bare.info()).toEqual({
      name: "YegaBet",
      domain: "yega.bet",
      botUsername: null,
      webappUrl: "https://yega.bet/",
    });
  });
});

describe("agent name on the site", () => {
  it("shows an active agent's name for its link, never the company or a paused agent", async () => {
    const a = (
      await http()
        .post("/admin/agents")
        .set(as(ownerTok))
        .send({ slug: `adm-pub-${n}`, displayName: "xyz shop" })
    ).body;
    expect((await http().get(`/public/agents/adm-pub-${n}`)).body).toEqual({
      slug: `adm-pub-${n}`,
      displayName: "xyz shop",
    });
    expect((await http().get("/public/agents/company")).status).toBe(404);
    expect((await http().get("/public/agents/no-such")).status).toBe(404);
    await http().post(`/admin/agents/${a.id}/status`).set(as(ownerTok)).send({ status: "paused" });
    expect((await http().get(`/public/agents/adm-pub-${n}`)).status).toBe(404);
  });

  it("tells a player their agent", async () => {
    expect((await http().get("/me/agent").set(as(playerTok))).body).toEqual({
      slug: "company",
      displayName: "Company",
      isCompany: true,
    });
    expect((await http().get("/me/agent").set(as(memberTok))).status).toBe(403);
  });
});

describe("pieces", () => {
  it("maps admin errors and rethrows others; links without a bot", () => {
    const status = (c: AdminError["code"]) => {
      try {
        adminHttp(new AdminError(c, "x"));
      } catch (e) {
        return (e as HttpException).getStatus();
      }
    };
    expect(
      ["NOT_FOUND", "CONFLICT", "REFUSED", "INVALID_INPUT"].map((c) => status(c as AdminError["code"])),
    ).toEqual([404, 409, 403, 400]);
    expect(() => adminHttp(new Error("raw"))).toThrow("raw");
    const admin = new Admin(db, new Hierarchy(db, new Ledger(db)), { domain: "x.example" });
    expect(admin.referralLinks("abc")).toEqual({ telegram: null, website: "https://x.example/?ref=abc" });
  });

  it("passes unexpected errors through", async () => {
    const owner: Principal = { kind: "staff", staffId: 1n, roles: ["owner"] };
    const broken = new Admin(
      {
        agentMember: { create: () => Promise.reject(new Error("db down")) },
        agent: { findUnique: async () => ({ status: "active" }) },
      } as never,
      { createAgent: () => Promise.reject(new Error("tree down")) } as never,
      { domain: "x" },
    );
    await expect(broken.createAgent(owner, { slug: "abc", displayName: "Abc" })).rejects.toThrow("tree down");
    await expect(
      broken.addMember(owner, 1n, { telegramUserId: "12345", displayName: "Abc" }),
    ).rejects.toThrow("db down");
  });
});
