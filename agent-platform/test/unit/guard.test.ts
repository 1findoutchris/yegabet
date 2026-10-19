import "reflect-metadata";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PermissionGuard, Public, Requires } from "../../src/auth/guard";
import type { Principal } from "../../src/auth/rbac";

// Test-only routes: one public, one per rule, one with no rule at all.
@Controller("t")
class RoutesController {
  @Public()
  @Get("open")
  open() {
    return "open";
  }

  @Requires("config.write")
  @Get("config")
  config() {
    return "config";
  }

  @Get("forgotten")
  forgotten() {
    return "should never be reachable";
  }
}

@Requires("players.read.own")
@Controller("own")
class OwnController {
  @Get()
  list() {
    return "own players";
  }
}

// Stands in for the login layer (Task 04): a test header picks a principal.
const PRINCIPALS: Record<string, Principal> = {
  owner: { kind: "staff", staffId: 1n, roles: ["owner"] },
  support: { kind: "staff", staffId: 2n, roles: ["support"] },
  member: { kind: "agent_member", memberId: 3n, agentId: 9n },
};

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RoutesController, OwnController],
    providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.use(
    (req: { headers: Record<string, string>; principal?: Principal }, _res: unknown, next: () => void) => {
      const who = req.headers["x-test-principal"];
      if (who) req.principal = PRINCIPALS[who];
      next();
    },
  );
  await app.init();
});
afterAll(() => app.close());

const get = (path: string, who?: string) => {
  const r = request(app.getHttpServer()).get(path);
  return who ? r.set("x-test-principal", who) : r;
};

it("lets anyone through a @Public() route", async () => {
  expect((await get("/t/open")).status).toBe(200);
});

it("refuses a route with no access rule, even for the owner (deny by default)", async () => {
  const res = await get("/t/forgotten", "owner");
  expect(res.status).toBe(403);
  expect(res.body.message).toBe("route has no access rule");
});

it("needs a principal for a protected route", async () => {
  expect((await get("/t/config")).status).toBe(401);
});

it("checks the permission", async () => {
  expect((await get("/t/config", "owner")).status).toBe(200);
  expect((await get("/t/config", "support")).status).toBe(403);
  expect((await get("/t/config", "member")).status).toBe(403);
});

it("applies a class-level rule to every route in the controller", async () => {
  expect((await get("/own", "member")).text).toBe("own players");
  expect((await get("/own", "owner")).status).toBe(403);
});
