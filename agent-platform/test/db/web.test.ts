import "reflect-metadata";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { loadEnv } from "../../src/config/env";
import { PrismaService } from "../../src/db/prisma.service";
import { CSP, configureWeb } from "../../src/web";
import { PHONE_KEYS } from "../keys";
import { TEST_DATABASE_URL } from "./testDb";

async function boot(dir: string) {
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
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  const served = configureWeb(app, dir);
  await app.init();
  return { app, served };
}

it("serves the web app at / with security headers, next to the API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>YegaBet</title>");
  writeFileSync(join(dir, "app.js"), "console.log(1)");
  const { app, served } = await boot(dir);
  expect(served).toBe(true);
  const page = await request(app.getHttpServer()).get("/");
  expect(page.status).toBe(200);
  expect(page.text).toContain("<title>YegaBet</title>");
  expect(page.headers["content-security-policy"]).toBe(CSP);
  expect(page.headers["cache-control"]).toBe("no-cache");
  expect((await request(app.getHttpServer()).get("/app.js")).headers["cache-control"]).toMatch(/immutable/);
  const health = await request(app.getHttpServer()).get("/health");
  expect(health.body.status).toBe("ok");
  expect(health.headers["x-content-type-options"]).toBe("nosniff");
  await app.close();
});

it("without a built web app the API still runs (and / is 404)", async () => {
  const { app, served } = await boot(mkdtempSync(join(tmpdir(), "noweb-")));
  expect(served).toBe(false);
  expect((await request(app.getHttpServer()).get("/")).status).toBe(404);
  await app.close();
});
