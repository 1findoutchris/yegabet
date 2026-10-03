import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as launch } from "@/app/api/octhera/launch/route";
import { GET as status } from "@/app/api/octhera/status/route";
import { POST as webhook } from "@/app/api/provider/octhera/callback/route";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asAnon, asUser } from "../helpers/session";

/*
 * Octhera test integration (Aviator via /octhera-test).
 * `fetch` is stubbed — nothing here reaches Octhera.
 */

const SECRET = "test-octhera-callback-secret";
const ENV = ["OCTHERA_API_KEY", "OCTHERA_CALLBACK_SECRET", "OCTHERA_TEST_USERS", "OCTHERA_AVIATOR_GAME_UID", "OCTHERA_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const sign = (raw: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const sendWebhook = (body: unknown, signature?: string) => {
  const raw = JSON.stringify(body);
  return webhook(req("POST", "/api/provider/octhera/callback", { body: raw, headers: { "x-octhera-signature": signature ?? sign(raw) } }));
};
const event = (over: Record<string, unknown> = {}) => ({
  version: 2, action: "bet", username: "vb_tester", balance: 99, currency: "ETB", betAmount: 1, winAmount: 0,
  txnId: "t-1", gameRound: "r-1", gameUid: "aviator-uid", gameName: "Aviator", providerTimestamp: "2026-10-03 10:00:00",
  ...over,
});

let tester: { id: string; phone: string; balance: unknown };

beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.OCTHERA_API_KEY = "test-key";
  process.env.OCTHERA_CALLBACK_SECRET = SECRET;
  delete process.env.OCTHERA_AVIATOR_GAME_UID;
  delete process.env.OCTHERA_BASE_URL;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await truncateAll();
  tester = await makeUser({ balance: 500 });
  process.env.OCTHERA_TEST_USERS = `+251000000000, ${tester.phone}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("access", () => {
  test("anonymous → 401", async () => {
    asAnon();
    expect((await json(await launch(req("POST", "/api/octhera/launch", { body: {} })))).status).toBe(401);
  });

  test("a user not on OCTHERA_TEST_USERS → 404, and Octhera is never called", async () => {
    const other = await makeUser();
    asUser({ id: other.id });
    expect((await json(await launch(req("POST", "/api/octhera/launch", { body: {} })))).status).toBe(404);
    expect((await json(await status())).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("OCTHERA_TEST_USERS unset → nobody, not even the tester", async () => {
    delete process.env.OCTHERA_TEST_USERS;
    asUser({ id: tester.id });
    expect((await json(await launch(req("POST", "/api/octhera/launch", { body: {} })))).status).toBe(404);
  });
});

describe("launch Aviator", () => {
  test("registers (409 = already ok), finds Spribe Aviator, launches with Bearer auth", async () => {
    asUser({ id: tester.id });
    reply({ code: 409, status: "fail", message: "username already registered" }, 409);
    reply({ status: "ok", games: [
      { gameUid: "fake", name: "Aviator X", provider: "OTHER", providerName: "Other", type: "Crash" },
      { gameUid: "aviator-uid", name: "Aviator", provider: "SPRIBE", providerName: "Spribe", type: "Crash" },
    ] });
    reply({ status: "ok", launchUrl: "https://api.octhera.org/wrapper?token=abc", transferId: "x" });

    const { status: code, body } = await json<{ launchUrl: string; username: string }>(
      await launch(req("POST", "/api/octhera/launch", { body: { device: "mobile" } }))
    );
    expect(code).toBe(200);
    expect(body.launchUrl).toBe("https://api.octhera.org/wrapper?token=abc");
    expect(body.username).toBe(`vb_${tester.id}`);

    const [reg, games, login] = fetchMock.mock.calls;
    expect(reg[0]).toBe("https://api.octhera.org/api/v1/players/register");
    expect(reg[1].headers.Authorization).toBe("Bearer test-key");
    expect(String(games[0])).toContain("/games?q=Aviator");
    expect(login[0]).toBe("https://api.octhera.org/api/v1/players/login");
    expect(JSON.parse(login[1].body)).toEqual({ username: `vb_${tester.id}`, gameUid: "aviator-uid", lang: "en", device: "mobile" });
  });

  test("Octhera's reason is shown when a launch is refused", async () => {
    asUser({ id: tester.id });
    process.env.OCTHERA_AVIATOR_GAME_UID = "aviator-uid";
    reply({ status: "ok", player: { username: "x", balance: 0, currency: "ETB" } }, 201);
    reply({ code: 403, status: "fail", message: "set lobbyUrl before launching games" }, 403);
    const { status: code, body } = await json<{ error: string }>(await launch(req("POST", "/api/octhera/launch", { body: {} })));
    expect(code).toBe(502);
    expect(body.error).toBe("Octhera: set lobbyUrl before launching games");
  });
});

describe("webhook", () => {
  test("bad or missing signature → 401, nothing stored", async () => {
    expect((await json(await sendWebhook(event(), "sha256=deadbeef"))).status).toBe(401);
    expect((await json(await sendWebhook(event(), sign(JSON.stringify(event()), "wrong-secret")))).status).toBe(401);
    expect(await prisma.octheraEvent.count()).toBe(0);
  });

  test("signed events are stored; retries are ignored; VinnaBet balance untouched", async () => {
    expect((await json(await sendWebhook(event()))).status).toBe(200);
    expect((await json(await sendWebhook(event()))).status).toBe(200); // retry
    expect((await json(await sendWebhook(event({ action: "win", txnId: "t-2", betAmount: 0, winAmount: 2.5, balance: 101.5 })))).status).toBe(200);
    const rows = await prisma.octheraEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.action, Number(r.betAmount), Number(r.winAmount), Number(r.balance)])).toEqual([
      ["bet", 1, 0, 99], ["win", 0, 2.5, 101.5],
    ]);
    expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: tester.id } })).balance)).toBe(500);
  });

  test("withdrawal steps that reuse one txnId are each kept", async () => {
    const w = { username: "vb_tester", txnId: "wmu1", gameRound: null, gameUid: null, gameName: null, betAmount: 0, winAmount: 0, amount: 25 };
    await sendWebhook(event({ ...w, action: "withdraw_requested", balance: 93.5 }));
    await sendWebhook(event({ ...w, action: "withdraw_confirmed", balance: 93.5 }));
    expect((await prisma.octheraEvent.findMany()).map((r) => r.action).sort()).toEqual(["withdraw_confirmed", "withdraw_requested"]);
  });

  test("malformed body → 400", async () => {
    expect((await json(await sendWebhook({ action: "bet" }))).status).toBe(400);
  });
});

describe("status", () => {
  test("tester sees their Octhera balance and only their own events", async () => {
    asUser({ id: tester.id });
    const me = `vb_${tester.id}`;
    await sendWebhook(event({ username: me, txnId: "mine" }));
    await sendWebhook(event({ username: "vb_someoneelse", txnId: "theirs" }));
    reply({ status: "ok", username: me, balance: 118.5, currency: "ETB" });
    const { body } = await json<{ balance: { balance: number }; events: { txnId: string }[] }>(await status());
    expect(body.balance.balance).toBe(118.5);
    expect(body.events.map((e) => e.txnId)).toEqual(["mine"]);
  });
});
