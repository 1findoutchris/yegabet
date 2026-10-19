import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { loadEnv } from "../../src/config/env";
import { addConfigVersion, configAt } from "../../src/config/configVersions";
import { isEnabled, setFlag } from "../../src/config/featureFlags";
import { PrismaService } from "../../src/db/prisma.service";
import { Ledger } from "../../src/ledger/ledger";
import { TEST_DATABASE_URL, testPrisma, uid } from "./testDb";

describe("GET /health", () => {
  async function boot(databaseUrl: string): Promise<INestApplication> {
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      APP_VERSION: "test-1",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(PrismaService)
      .useValue(new PrismaService({ datasources: { db: { url: databaseUrl } } }))
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    return app;
  }

  it("is 200 with db ok when the database is reachable, and wires the ledger", async () => {
    const app = await boot(TEST_DATABASE_URL);
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok", version: "test-1" });
    expect(new Date(res.body.time).toString()).not.toBe("Invalid Date");
    expect(app.get(Ledger)).toBeInstanceOf(Ledger);
    await app.close();
  });

  it("is 503 degraded when the database is down", async () => {
    const app = await boot("postgresql://postgres@localhost:1/nowhere_test?connect_timeout=1");
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", db: "down" });
    await app.close();
  });
});

describe("dated config and feature flags", () => {
  let db: PrismaClient;
  beforeAll(() => {
    db = testPrisma();
  });
  afterAll(() => db.$disconnect());

  it("returns the version in force at a time; history is immutable", async () => {
    const key = uid("commission.split");
    const v1 = await addConfigVersion(db, {
      key,
      value: { agent: 60 },
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      createdBy: "test",
    });
    await addConfigVersion(db, {
      key,
      value: { agent: 55 },
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      createdBy: "test",
    });

    expect(await configAt(db, key, new Date("2025-12-31T23:59:59Z"))).toBeNull();
    expect((await configAt(db, key, new Date("2026-01-01T00:00:00Z")))?.value).toEqual({ agent: 60 });
    expect((await configAt(db, key, new Date("2026-05-31T00:00:00Z")))?.value).toEqual({ agent: 60 });
    expect((await configAt(db, key, new Date("2026-06-01T00:00:00Z")))?.value).toEqual({ agent: 55 });
    expect((await configAt(db, key, new Date("2030-01-01T00:00:00Z")))?.value).toEqual({ agent: 55 });

    await expect(db.$executeRaw`UPDATE config_versions SET value = '{}' WHERE id = ${v1.id}`).rejects.toThrow(
      /immutable/,
    );
    await expect(db.$executeRaw`DELETE FROM config_versions WHERE id = ${v1.id}`).rejects.toThrow(
      /immutable/,
    );
  });

  it("flags are off unless switched on", async () => {
    const key = uid("flag");
    expect(await isEnabled(db, key)).toBe(false);
    await setFlag(db, key, true, "test");
    expect(await isEnabled(db, key)).toBe(true);
    await setFlag(db, key, false, "test");
    expect(await isEnabled(db, key)).toBe(false);
  });
});
