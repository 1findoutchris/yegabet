import { beforeAll, describe, expect, test } from "vitest";
import { truncateAll } from "../factories";
import { adminAuth, adminSecretOnly } from "../helpers/auth";
import { json, req } from "../helpers/req";
import { asAnon } from "../helpers/session";

/*
 * Table-driven guard check across every protected route.
 *
 * The value here is not the routes that exist today — it is the NEXT one. A new
 * admin route that forgets `requireAdminAuth`, or a user route that forgets
 * `await auth()`, silently exposes data with no other signal. Adding the module
 * to the table below is the only work required to cover it.
 *
 * Admin auth is two-factor and the two failure codes differ on purpose:
 *   no/incorrect secret  → 404  (the secret URL portal stays hidden entirely)
 *   secret but no session → 401
 */

const ADMIN_ROUTES = [
  ["promos", () => import("@/app/api/admin/promos/route")],
  ["deposits", () => import("@/app/api/admin/deposits/route")],
  ["payment-methods", () => import("@/app/api/admin/payment-methods/route")],
  ["payout-agents", () => import("@/app/api/admin/payout-agents/route")],
  ["rewards", () => import("@/app/api/admin/rewards/route")],
  ["sms", () => import("@/app/api/admin/sms/route")],
  ["spin", () => import("@/app/api/admin/spin/route")],
  ["spin/links", () => import("@/app/api/admin/spin/links/route")],
  ["stats", () => import("@/app/api/admin/stats/route")],
  ["users", () => import("@/app/api/admin/users/route")],
  ["withdrawals", () => import("@/app/api/admin/withdrawals/route")],
] as const;

const USER_ROUTES = [
  ["account", () => import("@/app/api/user/account/route")],
  ["balance", () => import("@/app/api/user/balance/route")],
  ["bonus", () => import("@/app/api/user/bonus/route")],
  ["cashback", () => import("@/app/api/user/cashback/route")],
  ["challenges", () => import("@/app/api/user/challenges/route")],
  ["leaderboards", () => import("@/app/api/user/leaderboards/route")],
  ["spin", () => import("@/app/api/user/spin/route")],
  ["streak", () => import("@/app/api/user/streak/route")],
  ["tickets", () => import("@/app/api/user/tickets/route")],
  ["withdraw", () => import("@/app/api/user/withdraw/route")],
] as const;

beforeAll(async () => {
  await truncateAll();
});

describe("admin routes", () => {
  test.each(ADMIN_ROUTES)("GET /api/admin/%s hides itself without the secret", async (name, load) => {
    const { GET } = await load();
    const { status } = await json(await GET(req("GET", `/api/admin/${name}`)));
    expect(status).toBe(404);
  });

  test.each(ADMIN_ROUTES)("GET /api/admin/%s rejects a secret with no session", async (name, load) => {
    const { GET } = await load();
    const { status } = await json(await GET(req("GET", `/api/admin/${name}`, adminSecretOnly())));
    expect(status).toBe(401);
  });

  test.each(ADMIN_ROUTES)("GET /api/admin/%s admits a fully authenticated admin", async (name, load) => {
    const { GET } = await load();
    const auth = await adminAuth();
    const { status } = await json(await GET(req("GET", `/api/admin/${name}`, auth)));
    // Not asserting 200 — some routes legitimately 400 on missing query params.
    // What matters is that it is no longer an AUTH rejection.
    expect(status).not.toBe(401);
    expect(status).not.toBe(404);
  });
});

describe("user routes", () => {
  test.each(USER_ROUTES)("GET /api/user/%s requires a session", async (name, load) => {
    asAnon();
    const mod = await load();
    if (!("GET" in mod)) return; // POST-only route

    // Several of these handlers are declared `GET()` with no parameters —
    // they read the session, not the request. Passing one anyway is harmless
    // at runtime, so widen the type rather than special-casing each route.
    const handler = mod.GET as (r?: unknown) => Promise<Response>;
    const { status } = await json(await handler(req("GET", `/api/user/${name}`)));
    expect(status).toBe(401);
  });
});
