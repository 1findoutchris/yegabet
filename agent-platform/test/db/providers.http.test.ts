import "reflect-metadata";
import { createHmac } from "node:crypto";
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
import { GameWallet } from "../../src/providers/gameWallet";
import { GAMES_FLAG, Games, GamesError } from "../../src/providers/games";
import type { OctheraClient, OctheraGame } from "../../src/providers/octhera/client";
import { ProviderJobs } from "../../src/providers/providers.module";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEYS, PHONE_KEY_PAIR } from "../keys";
import { TEST_DATABASE_URL, testPrisma } from "./testDb";

jest.setTimeout(120_000);

const SECRET = "octhera-test-secret";
let db: PrismaClient;
let launches: unknown[] = [];
let catalog: OctheraGame[][] = [];
const fakeClient = {
  listGames: async (page: number) => ({ total: catalog.flat().length, games: catalog[page - 1] ?? [] }),
  launch: async (p: unknown) => {
    launches.push(p);
    if ((p as { gameUid: string }).gameUid === "boom") throw new Error("octhera down");
    return "https://play.example/one-time";
  },
} as unknown as OctheraClient;

async function boot(extra: Record<string, string>, games?: Games): Promise<INestApplication> {
  const env = loadEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...PHONE_KEYS,
    ...extra,
  });
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PrismaService)
    .useValue(new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL } } }));
  if (games) builder = builder.overrideProvider(Games).useValue(games);
  const app = (await builder.compile()).createNestApplication({ logger: false, rawBody: true });
  await app.init();
  return app;
}

let app: INestApplication;
beforeAll(async () => {
  db = testPrisma();
  app = await boot({ OCTHERA_WALLET_SECRET: SECRET, OCTHERA_API_KEY: "k" }, new Games(db, fakeClient));
});
afterAll(async () => {
  await setFlag(db, GAMES_FLAG, false, "test");
  await app.close();
  await db.$disconnect();
});

const hit = (a: INestApplication, body: object, opts: { secret?: string; ts?: number } = {}) => {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${ts}.${raw}`)
    .digest("hex");
  return request(a.getHttpServer())
    .post("/providers/octhera/wallet")
    .set("content-type", "application/json")
    .set("x-octhera-timestamp", String(ts))
    .set("x-octhera-signature", `v1=${sig}`)
    .send(raw);
};

describe("Octhera wallet endpoint", () => {
  it("answers ping, a signed bet with the new balance, and refuses bad signatures and requests", async () => {
    const ledger = new Ledger(db);
    const agent = await new Hierarchy(db, ledger).createAgent({
      slug: `prov-${process.pid}`,
      displayName: "P",
    });
    const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({
      phone: "+251988000001",
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
      idempotencyKey: `prov-fund-${player.id}`,
      reason: "deposit",
      entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: 10_000n }],
    });

    expect((await hit(app, { type: "ping" })).body).toEqual({ status: "ok" });
    const bet = {
      version: 2,
      type: "debit",
      action: "bet",
      txnId: `h-${process.pid}-1`,
      playerId: `yb_${player.id}`,
      currency: "ETB",
      betAmount: 12.5,
      winAmount: 0,
      gameRound: "HR1",
    };
    const res = await hit(app, bet);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", balance: 87.5 });
    expect((await hit(app, bet)).body).toEqual({ status: "ok", balance: 87.5 }); // retry
    expect((await hit(app, { ...bet, txnId: `h-${process.pid}-2`, betAmount: 1000 })).body).toEqual({
      status: "error",
      code: "INSUFFICIENT_FUNDS",
      balance: 87.5,
    });

    expect((await hit(app, bet, { secret: "wrong" })).body).toEqual({
      status: "error",
      code: "INVALID_SIGNATURE",
    });
    expect((await hit(app, bet, { ts: Math.floor(Date.now() / 1000) - 3600 })).body).toEqual({
      status: "error",
      code: "INVALID_SIGNATURE",
    });
    expect((await request(app.getHttpServer()).post("/providers/octhera/wallet").send(bet)).body).toEqual({
      status: "error",
      code: "INVALID_SIGNATURE",
    });
    expect((await hit(app, { ...bet, currency: "USD" })).body).toEqual({
      status: "error",
      code: "INVALID_REQUEST",
    });
    // No body and no headers at all.
    expect((await request(app.getHttpServer()).post("/providers/octhera/wallet")).body).toEqual({
      status: "error",
      code: "INVALID_SIGNATURE",
    });
    // A rollback of the bet over HTTP: the 12.50 comes back.
    const rollback = {
      version: 2,
      type: "rollback",
      txnId: bet.txnId,
      playerId: bet.playerId,
      currency: "ETB",
      betAmount: 12.5,
      winAmount: 0,
    };
    expect((await hit(app, rollback)).body).toEqual({ status: "ok", balance: 100 });
  });

  it("without the wallet secret every call is INVALID_SIGNATURE (HTTP 200)", async () => {
    const bare = await boot({});
    const res = await hit(bare, { type: "ping" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "error", code: "INVALID_SIGNATURE" });
    expect((await request(bare.getHttpServer()).post("/games/x/launch")).status).toBe(401);
    await bare.close();
  });
});

describe("catalog", () => {
  it("imports every page, keeps it on a partial import, and deactivates missing games after a complete one", async () => {
    const games = new Games(db, fakeClient);
    catalog = [
      [
        { gameUid: `cat-${process.pid}-1`, name: "Aviator", type: "Crash", provider: "SPRIBE" },
        { gameUid: "", name: "broken" } as OctheraGame,
      ],
      [
        {
          gameUid: `cat-${process.pid}-2`,
          name: "Book of Ra",
          type: "Slot",
          providerName: "Novomatic",
          img: "https://img/2",
        },
      ],
    ];
    expect(await games.importCatalog()).toEqual({
      fetched: 3,
      deactivated: expect.any(Number),
      complete: true,
    });
    expect(
      await db.game.findUniqueOrThrow({
        where: { providerId_gameUid: { providerId: "octhera", gameUid: `cat-${process.pid}-1` } },
      }),
    ).toMatchObject({
      providerName: "SPRIBE",
      active: true,
    });

    // The second game is gone from Octhera: deactivated, not deleted.
    catalog = [[{ gameUid: `cat-${process.pid}-1`, name: "Aviator" }]];
    expect((await games.importCatalog()).deactivated).toBeGreaterThanOrEqual(1);
    expect(
      (
        await db.game.findUniqueOrThrow({
          where: { providerId_gameUid: { providerId: "octhera", gameUid: `cat-${process.pid}-2` } },
        })
      ).active,
    ).toBe(false);

    // A page that stops early: incomplete, nothing taken off.
    const partial = new Games(db, {
      listGames: async () => ({ total: 50, games: [] }),
    } as unknown as OctheraClient);
    expect(await partial.importCatalog()).toEqual({ fetched: 0, deactivated: 0, complete: false });
    const noTotal = new Games(db, { listGames: async () => ({}) } as unknown as OctheraClient);
    expect(await noTotal.importCatalog()).toMatchObject({ complete: true, deactivated: 0 });
    await expect(new Games(db, null).importCatalog()).rejects.toThrow(GamesError);
  });

  it("lists active games with filters, publicly", async () => {
    catalog = [[{ gameUid: `list-${process.pid}`, name: "Lucky Crash", type: "Crash" }]];
    await new Games(db, fakeClient).importCatalog();
    const http = request(app.getHttpServer());
    const res = await http.get("/games?type=Crash&search=lucky");
    expect(res.status).toBe(200);
    expect(res.body.games.map((g: { gameUid: string }) => g.gameUid)).toContain(`list-${process.pid}`);
    expect((await http.get("/games?page=999")).body).toMatchObject({ page: 500, games: [] });
    expect((await http.get("/games")).body.page).toBe(1);
    const lobby = await http.get("/games/lobby");
    expect(lobby.status).toBe(200);
    expect(lobby.body).toHaveProperty("counts.slots");
    expect(lobby.body).toHaveProperty("rows.popular");
  });
});

describe("launch", () => {
  it("needs the flag, an active game, an active player; returns a single-use URL", async () => {
    const ledger = new Ledger(db);
    const agent = await new Hierarchy(db, ledger).createAgent({
      slug: `launch-${process.pid}`,
      displayName: "L",
    });
    const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({
      phone: "+251988000002",
      referralSlug: agent.slug,
    });
    const sessions = new Sessions(db, 3_600_000);
    const tok = (await sessions.create({ kind: "player", id: player.id })).token;
    const m = await db.agentMember.create({ data: { agentId: agent.id, displayName: "m" } });
    const agentTok = (await sessions.create({ kind: "agent_member", id: m.id })).token;
    catalog = [
      [
        { gameUid: `play-${process.pid}`, name: "Playable" },
        { gameUid: "boom", name: "Explodes" },
      ],
    ];
    await new Games(db, fakeClient).importCatalog();
    const http = () => request(app.getHttpServer());
    const launch = (uid: string, t = tok, device?: string) =>
      http()
        .post(`/games/${uid}/launch`)
        .set("authorization", `Bearer ${t}`)
        .send(device ? { device } : {});

    await setFlag(db, GAMES_FLAG, false, "test");
    expect((await launch(`play-${process.pid}`)).status).toBe(503);
    await setFlag(db, GAMES_FLAG, true, "test");
    expect((await launch("no-such-game")).status).toBe(404);
    expect((await launch(`play-${process.pid}`, agentTok)).status).toBe(403);
    launches = [];
    const ok = await launch(`play-${process.pid}`, tok, "mobile");
    expect(ok.body).toEqual({ url: "https://play.example/one-time" });
    expect(launches[0]).toEqual({
      playerId: `yb_${player.id}`,
      balance: 0,
      gameUid: `play-${process.pid}`,
      device: "mobile",
    });
    await launch(`play-${process.pid}`);
    expect((launches[1] as { device: string }).device).toBe("desktop");
    expect((await launch("boom")).status).toBe(500);
    // A paused agent's players can't start games (their session is still valid).
    await db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
    expect((await launch(`play-${process.pid}`)).status).toBe(403);
    // A frozen player's session stops working altogether.
    await db.player.update({ where: { id: player.id }, data: { status: "frozen" } });
    expect((await launch(`play-${process.pid}`)).status).toBe(401);
    expect(
      await new Games(db, fakeClient)
        .launch(999_999_999n, `play-${process.pid}`, undefined)
        .catch((e: GamesError) => e.code),
    ).toBe("PLAYER_NOT_ALLOWED");
    await expect(new Games(db, null).launch(player.id, "x", undefined)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(
      await new Games(db, fakeClient).launch(player.id, "x", undefined).catch((e: GamesError) => e.code),
    ).toBe("NOT_FOUND");
  });
});

describe("jobs", () => {
  it("import the catalog and settle old bets, logging failures, and stay off in tests", async () => {
    const wallet = new GameWallet(db, new Ledger(db));
    const games = new Games(db, fakeClient);
    const env = (key?: string, nodeEnv = "test") => ({ OCTHERA_API_KEY: key, NODE_ENV: nodeEnv }) as never;
    catalog = [[{ gameUid: `job-${process.pid}`, name: "Job" }]];
    await new ProviderJobs(games, wallet, db as never, env("k")).tick();
    await new ProviderJobs(games, wallet, db as never, env(undefined)).tick();
    await new ProviderJobs(
      { importCatalog: async () => ({ fetched: 0, deactivated: 0, complete: false }) } as never,
      wallet,
      db as never,
      env("k"),
    ).tick();
    await new ProviderJobs(
      { importCatalog: () => Promise.reject(new Error("down")) } as never,
      { autoSettle: () => Promise.reject(new Error("db")) } as never,
      db as never,
      env("k"),
    ).tick();
    await new ProviderJobs(games, { autoSettle: async () => 3 } as never, db as never, env(undefined)).tick();
    await new ProviderJobs(
      games,
      wallet,
      { configVersion: { findFirst: async () => null } } as never,
      env(undefined),
    ).tick();
    jest.useFakeTimers();
    const live = new ProviderJobs(
      { importCatalog: jest.fn(async () => ({ fetched: 0, deactivated: 0, complete: true })) } as never,
      { autoSettle: jest.fn(async () => 0) } as never,
      db as never,
      env("k", "production"),
    );
    live.onModuleInit();
    jest.advanceTimersByTime(60 * 60 * 1000);
    live.onModuleDestroy();
    jest.useRealTimers();
    expect(app.get(ProviderJobs)).toBeInstanceOf(ProviderJobs);
  });
});
