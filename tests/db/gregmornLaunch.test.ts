import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/games/launch/route";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asUser, asAnon } from "../helpers/session";

/*
 * /api/games/launch with GAME_PROVIDER=gregmorn.
 *
 * Runs on the legacy catalog (GAME_CATALOG=legacy): with the default Octhera
 * catalog, only the sportsbook still launches through the main provider —
 * tests/db/catalog.test.ts covers that.
 *
 * `fetch` is stubbed for every test — nothing here can reach Gregmorn, so no
 * session is ever created on their side and nothing can bill.
 */

const SECRET = "test-gregmorn-hmac-secret";
const USER_ID = "00000000-0000-0000-0000-00000000test";

const ENV_KEYS = [
  "GAME_PROVIDER", "GREGMORN_LIVE", "GREGMORN_DEMO", "GREGMORN_USER_ID",
  "GREGMORN_SECRET_KEY", "SILENT_API_LIVE", "NEXT_PUBLIC_APP_URL", "GAME_CATALOG",
] as const;
const saved: Record<string, string | undefined> = {};

const fetchMock = vi.fn();

function launch(game_uid: string) {
  return POST(req("POST", "/api/games/launch", { body: { game_uid } }));
}

function providerReplies(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
}

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GAME_PROVIDER = "gregmorn";
  process.env.GAME_CATALOG = "legacy";
  process.env.GREGMORN_USER_ID = USER_ID;
  process.env.GREGMORN_SECRET_KEY = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  delete process.env.GREGMORN_LIVE;
  delete process.env.GREGMORN_DEMO;
  delete process.env.SILENT_API_LIVE;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  asAnon();
});

describe("kill switch off (default)", () => {
  test("returns a mock URL, persists the session, never calls the provider", async () => {
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });

    const { status, body } = await json(await launch("black:pg:1024"));
    expect(status).toBe(200);
    expect(body.game_launch_url).toBe("http://localhost:3000/mock-game?game=black%3Apg%3A1024");
    expect(fetchMock).not.toHaveBeenCalled();

    const sessions = await prisma.gameSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].gameId).toBe("black:pg:1024");

    const recent = await prisma.recentGame.findMany({ where: { userId: user.id } });
    expect(recent.map((r) => r.gameId)).toEqual(["black:pg:1024"]);
  });

  test("anonymous launch is 401", async () => {
    const res = await launch("black:pg:1024");
    expect(res.status).toBe(401);
  });
});

describe("live", () => {
  beforeEach(() => {
    process.env.GREGMORN_LIVE = "true";
  });

  test("sends a correctly signed openGame and stores the returned session", async () => {
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });
    providerReplies({
      status: "success", error: "",
      content: { game: { url: "https://cdn.example/game?s=1" }, gameRes: { sessionId: "71516353" } },
    });

    const { status, body } = await json(await launch("black:pg:1024"));
    expect(status).toBe(200);
    expect(body.game_launch_url).toBe("https://cdn.example/game?s=1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://client-api.gregmorn.org/games/openGame");

    const raw = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Signature"]).toBe(createHmac("sha256", SECRET).update(raw).digest("hex"));

    const sent = JSON.parse(raw);
    expect(sent).toMatchObject({
      currency: "ETB",
      demo: "0",
      gameId: "black:pg:1024",
      player_login: user.id,
      user_id: USER_ID,
      exitUrl: "http://localhost:3000/dashboard",
    });

    const s = await prisma.gameSession.findUniqueOrThrow({ where: { sessionId: "71516353" } });
    expect(s.userId).toBe(user.id);
  });

  test("GREGMORN_DEMO=true forces demo mode even when live", async () => {
    process.env.GREGMORN_DEMO = "true";
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });
    providerReplies({
      status: "success", error: "",
      content: { game: { url: "https://cdn.example/demo" }, gameRes: { sessionId: "demo-1" } },
    });

    await launch("black:pg:1024");
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.demo).toBe("1");
  });

  test("a provider refusal surfaces as 502 unavailable, no session stored", async () => {
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });
    providerReplies({ status: "fail", error: "game disabled", content: {} }, 400);

    const { status, body } = await json(await launch("black:pg:1024"));
    expect(status).toBe(502);
    expect(body.unavailable).toBe(true);

    expect(await prisma.gameSession.count({ where: { userId: user.id } })).toBe(0);
  });

  test("a non-JSON provider response surfaces as 502, not a crash", async () => {
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const { status } = await json(await launch("black:pg:1024"));
    expect(status).toBe(502);
  });
});

describe("provider switch", () => {
  test("GAME_PROVIDER unset keeps Silent — no Gregmorn session is created", async () => {
    delete process.env.GAME_PROVIDER;
    const user = await makeUser({ balance: 100 });
    asUser({ id: user.id, username: user.username });

    const { status, body } = await json(await launch("some-silent-uid"));
    expect(status).toBe(200);
    // Silent's mock (SILENT_API_LIVE unset) — also never touches the network.
    expect(body.game_launch_url).toContain("/mock-game?game=some-silent-uid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.gameSession.count()).toBe(0);
  });
});
