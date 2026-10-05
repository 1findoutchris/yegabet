import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { classify, SECTION_CATEGORIES } from "@/lib/catalogClassify";
import { fetchCatalog } from "@/lib/providers/octhera";
import { makeCatalog, pages } from "../fixtures/octheraCatalog";

/*
 * Where each Octhera game goes (section + category), and paging through
 * Octhera's catalog. `fetch` is stubbed — nothing here reaches Octhera.
 */

describe("classify: Octhera type → site section", () => {
  test.each([
    ["Slots", "Sweet Bonanza", "casino", "slots"],
    ["Video Slot", "Book of Dead", "casino", "slots"],
    ["Casino Live", "Lightning Roulette", "casino", "live"],
    ["live_dealer", "Speed Baccarat", "casino", "live"],
    ["Table Games", "European Roulette", "casino", "table"],
    ["Card", "Teen Patti", "casino", "table"],
    ["Crash", "Aviator", "games", "crash"],
    ["Instant Win", "Mines", "games", "crash"],
    ["Mini Games", "Plinko", "games", "crash"],
    ["Fishing", "Ocean King", "games", "fishing"],
    ["Shooting", "Fish Hunter", "games", "fishing"],
    ["Lottery", "Lucky Draw", "games", "lottery"],
    ["Keno", "Keno 80", "games", "lottery"],
    ["Scratch Cards", "Gold Scratch", "games", "lottery"],
    ["Arcade", "Pixel Run", "games", "arcade"],
    ["Sportsbook", "Sportsbook", "sports", "sportsbook"],
    ["Sports", "Live Betting", "sports", "sportsbook"],
    ["Virtual Sports", "Virtual Football", "sports", "virtual"],
    ["eSports", "CS2 Betting", "sports", "esports"],
  ])("%s / %s → %s · %s", (type, name, section, category) => {
    expect(classify(type, name)).toEqual({ section, category, known: true });
  });

  test("a vague type falls back to the name", () => {
    expect(classify("Casino", "Aviator")).toMatchObject({ section: "games", category: "crash" });
    expect(classify("Casino", "Auto Roulette")).toMatchObject({ section: "casino", category: "table" });
    expect(classify("", "Live Blackjack")).toMatchObject({ section: "casino", category: "live" });
    expect(classify("Casino", "Sweet Fortune")).toMatchObject({ section: "casino", category: "slots" });
  });

  test("a type nothing explains goes to Games → More Games, flagged unknown", () => {
    expect(classify("Specialty", "Wonder Wheel Deluxe")).toEqual({ section: "games", category: "other", known: false });
    expect(classify(undefined, "Something")).toEqual({ section: "games", category: "other", known: false });
  });

  test("casino titles never land in Rewards or Sports by accident", () => {
    for (const g of makeCatalog()) {
      const p = classify(g.type, g.name);
      expect(Object.keys(SECTION_CATEGORIES)).toContain(p.section);
      if (g.type === "Slots") expect(p.section).toBe("casino");
    }
  });
});

describe("fetchCatalog: every page, no duplicates", () => {
  const fetchMock = vi.fn();
  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OCTHERA_API_KEY;
    process.env.OCTHERA_API_KEY = "test-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.OCTHERA_API_KEY;
    else process.env.OCTHERA_API_KEY = savedKey;
  });

  test("456 games over 3 pages → all 456, complete", async () => {
    const all = makeCatalog();
    for (const p of pages(all)) reply(p);
    const r = await fetchCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toBe("https://api.octhera.org/api/v2/games?page=3&limit=200");
    expect(r).toMatchObject({ pages: 3, total: 456, complete: true, error: null });
    expect(r.games).toHaveLength(456);
  });

  test("a game repeated on the next page is kept once", async () => {
    const all = makeCatalog();
    const [p1, p2, p3] = pages(all);
    p2.games[0] = p1.games[5]; // Octhera's ordering shifted between page requests
    reply(p1); reply(p2); reply(p3);
    const r = await fetchCatalog();
    expect(new Set(r.games.map((g) => g.gameUid)).size).toBe(r.games.length);
    expect(r.games).toHaveLength(455);
    // total says 456 but one game was never seen → not complete
    expect(r.complete).toBe(false);
    expect(r.error).toBe("got 455 of 456 games");
  });

  test("a refused later page keeps earlier pages and reports incomplete", async () => {
    const [p1] = pages(makeCatalog());
    reply(p1);
    reply({ status: "fail", message: "rate limited" }, 429);
    const r = await fetchCatalog();
    expect(r.games).toHaveLength(200);
    expect(r).toMatchObject({ complete: false, error: "Octhera 429: rate limited" });
  });

  test("no `total`: a short page ends it, complete", async () => {
    reply({ status: "ok", games: makeCatalog().slice(0, 50) });
    const r = await fetchCatalog();
    expect(r).toMatchObject({ pages: 1, total: null, complete: true });
  });

  test("page 1 refused → throws", async () => {
    reply({ status: "fail", message: "invalid api key" }, 401);
    await expect(fetchCatalog()).rejects.toThrow("Octhera 401: invalid api key");
  });
});
