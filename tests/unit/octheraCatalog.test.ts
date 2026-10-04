import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/*
 * Octhera's whole catalog on the site (OCTHERA_GAMES_PUBLIC=true).
 * `fetch` is stubbed — nothing here reaches Octhera. Runs against the default
 * game_list/ catalog on disk, which has Spribe (Aviator, Mines, …).
 */

const ENV = ["OCTHERA_API_KEY", "OCTHERA_GAMES_PUBLIC", "OCTHERA_AVIATOR_PUBLIC", "OCTHERA_BASE_URL", "OCTHERA_PAGE"] as const;
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

  test("pages through the v2 catalog, 200 at a time, until a short page", async () => {
    const full = Array.from({ length: 200 }, (_, i) => game(`p1-${i}`, `Octhera Only Slot ${i}`));
    reply({ status: "ok", page: 1, limit: 200, total: 201, count: 200, games: full });
    reply({ status: "ok", page: 2, limit: 200, total: 201, count: 1, games: [
      { ...game("u3", "Octhera Only Stars"), img: "https://api.octhera.org/media/games/u3.webp" },
    ] });
    const games = await load();
    await games.loadOctheraGames();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.octhera.org/api/v2/games?page=1&limit=200");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.octhera.org/api/v2/games?page=2&limit=200");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");

    expect(games.getGamesByProvider("new-provider")).toHaveLength(201);
    // Octhera's own `img` when given, else the /media fallback
    expect(games.getGamesByIds(["octhera:u3"])[0].img).toBe("https://api.octhera.org/media/games/u3.webp");
    expect(games.getGamesByIds(["octhera:p1-0"])[0]).toMatchObject({
      provider: "new-provider",
      providerName: "New Provider",
      customGameType: 0,
      img: "https://api.octhera.org/media/games/p1-0",
    });
  });

  test("stops at `total` without asking for an empty page", async () => {
    const full = Array.from({ length: 200 }, (_, i) => game(`p1-${i}`, `Octhera Only Slot ${i}`));
    reply({ status: "ok", total: 200, games: full });
    const games = await load();
    await games.loadOctheraGames();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("games we already have stay on the main provider; new ones from a known provider join its page", async () => {
    reply({ status: "ok", games: [
      game("dup", "Aviator", "SPRIBE", "Spribe", "Crash"),         // already in game_list/spribe.json
      game("new", "Octhera Only Rocket", "SPRIBE", "Spribe", "Crash"),
      game("live", "Octhera Only Roulette", "LIVEPROV", "Live Prov", "Casino Live"),
    ] });
    const games = await load();
    await games.loadOctheraGames();

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

  test("Octhera refusing page 2 keeps page 1's games", async () => {
    const full = Array.from({ length: 200 }, (_, i) => game(`p1-${i}`, `Octhera Only Slot ${i}`));
    reply({ status: "ok", games: full });
    reply({ code: 429, status: "fail", message: "rate limited" }, 429);
    const games = await load();
    await games.loadOctheraGames();
    expect(games.getGamesByProvider("new-provider")).toHaveLength(200);
  });
});

describe("/octhera page catalog (loadOctheraPage)", () => {
  test("loads every Octhera game even with OCTHERA_GAMES_PUBLIC off — but keeps them out of the normal lists", async () => {
    delete process.env.OCTHERA_GAMES_PUBLIC;
    reply({ status: "ok", games: [game("dup", "Aviator", "SPRIBE", "Spribe", "Crash"), game("u1", "Octhera Only Fruits")] });
    const games = await load();
    const page = await games.loadOctheraPage();
    expect(page).toMatchObject({ on: true, error: null });
    // the page shows ALL of them, including one the main catalog also has
    expect(page.games.map((g) => g.gameID)).toEqual(["octhera:dup", "octhera:u1"]);
    expect(games.searchGames("octhera only")).toEqual([]);
  });

  test("OCTHERA_PAGE=off or no API key → off, Octhera never called", async () => {
    process.env.OCTHERA_PAGE = "off";
    let games = await load();
    expect(await games.loadOctheraPage()).toEqual({ on: false, games: [], error: null });
    delete process.env.OCTHERA_PAGE;
    delete process.env.OCTHERA_API_KEY;
    games = await load();
    expect((await games.loadOctheraPage()).on).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Octhera refusing → no games and the reason", async () => {
    reply({ code: 401, status: "fail", message: "invalid api key" }, 401);
    const games = await load();
    expect(await games.loadOctheraPage()).toEqual({ on: true, games: [], error: "Octhera 401: invalid api key" });
  });
});
