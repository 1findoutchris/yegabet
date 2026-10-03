import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/*
 * Octhera's whole catalog on the site (OCTHERA_GAMES_PUBLIC=true).
 * `fetch` is stubbed — nothing here reaches Octhera. Runs against the default
 * game_list/ catalog on disk, which has Spribe (Aviator, Mines, …).
 */

const ENV = ["OCTHERA_API_KEY", "OCTHERA_GAMES_PUBLIC", "OCTHERA_AVIATOR_PUBLIC", "OCTHERA_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

const game = (uid: string, name: string, provider = "NEWPROV", providerName = "New Provider", type = "Slots") =>
  ({ gameUid: uid, name, provider, providerName, type });

// Fresh module + fresh shared catalog per test.
async function load() {
  delete (globalThis as { __octheraCatalog?: unknown }).__octheraCatalog;
  vi.resetModules();
  return import("@/lib/games");
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.OCTHERA_API_KEY = "test-key";
  process.env.OCTHERA_GAMES_PUBLIC = "true";
  delete process.env.OCTHERA_AVIATOR_PUBLIC;
  delete process.env.OCTHERA_BASE_URL;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Octhera catalog", () => {
  test("switch off → Octhera never called, no octhera: games", async () => {
    delete process.env.OCTHERA_GAMES_PUBLIC;
    const games = await load();
    await games.loadOctheraGames();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(games.searchGames("octhera only")).toEqual([]);
  });

  test("pages through the catalog until a page brings nothing new", async () => {
    reply({ status: "ok", games: [game("u1", "Octhera Only Fruits"), game("u2", "Octhera Only Gems")] });
    reply({ status: "ok", games: [game("u3", "Octhera Only Stars")] });
    reply({ status: "ok", games: [] });
    const games = await load();
    await games.loadOctheraGames();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.octhera.org/api/v1/games?limit=100");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");

    const found = games.searchGames("octhera only");
    expect(found.map((g) => g.gameID).sort()).toEqual(["octhera:u1", "octhera:u2", "octhera:u3"]);
    expect(found[0]).toMatchObject({
      provider: "new-provider",
      providerName: "New Provider",
      customGameType: 0,
      img: expect.stringMatching(/^https:\/\/api\.octhera\.org\/media\/games\/u\d$/),
    });
    expect(games.getGamesByProvider("new-provider")).toHaveLength(3);
  });

  test("stops when pagination is ignored (same page again)", async () => {
    const page = { status: "ok", games: [game("u1", "Octhera Only Fruits")] };
    reply(page);
    reply(page);
    const games = await load();
    await games.loadOctheraGames();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(games.searchGames("octhera only")).toHaveLength(1);
  });

  test("games we already have stay on the main provider; new ones from a known provider join its page", async () => {
    reply({ status: "ok", games: [
      game("dup", "Aviator", "SPRIBE", "Spribe", "Crash"),         // already in game_list/spribe.json
      game("new", "Octhera Only Rocket", "SPRIBE", "Spribe", "Crash"),
      game("live", "Octhera Only Roulette", "LIVEPROV", "Live Prov", "Live Casino"),
    ], hasMore: false });
    const games = await load();
    await games.loadOctheraGames();

    expect(fetchMock).toHaveBeenCalledTimes(1); // hasMore: false
    const ids = games.getGamesByProvider("spribe").map((g) => g.gameID);
    expect(ids).toContain("octhera:new");
    expect(ids).not.toContain("octhera:dup");
    expect(games.getCrashGames().map((g) => g.gameID)).toContain("octhera:new");
    expect(games.getLiveCasinoGames(10_000).map((g) => g.gameID)).toContain("octhera:live");
  });

  test("Octhera down → site still works, nothing added", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const games = await load();
    await games.loadOctheraGames();
    expect(games.searchGames("octhera only")).toEqual([]);
    expect(games.getGamesByProvider("spribe").length).toBeGreaterThan(0);
  });
});
