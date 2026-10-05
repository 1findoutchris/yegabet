import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncCatalog, resetCatalogCache } from "@/lib/catalog";
import {
  loadGames, getSectionGames, getSectionCategories, getProviderStats, searchGames, getGamesByIds,
  getPopularGames, getCategoryCounts, getGameNamesForHistory, getGamesByProvider, getHotGames,
} from "@/lib/games";
import { loadLegacyFiles } from "@/lib/legacyCatalog";
import { POST as gamesLaunch } from "@/app/api/games/launch/route";
import { POST as cronSync } from "@/app/api/cron/catalog-sync/route";
import { SPORTSBOOK_GAME_UID } from "@/types/games";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asUser } from "../helpers/session";
import { makeCatalog, pages, type FixtureGame } from "../fixtures/octheraCatalog";

/*
 * The site's catalog = everything on our Octhera account (lib/catalog),
 * organized into Casino and Games. Octhera's sports content is classified but
 * never shown: the sportsbook stays the original one. `fetch` is stubbed with a made-up
 * 456-game catalog (tests/fixtures/octheraCatalog.ts) — nothing reaches Octhera.
 */

const ENV = [
  "OCTHERA_API_KEY", "OCTHERA_BASE_URL", "GAME_CATALOG", "OCTHERA_GAMES_PUBLIC", "OCTHERA_AVIATOR_PUBLIC",
  "GAME_PROVIDER", "GREGMORN_USER_ID", "GREGMORN_SECRET_KEY", "GREGMORN_LIVE", "NEXT_PUBLIC_APP_URL",
] as const;
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const serve = (games: FixtureGame[]) => { for (const p of pages(games)) reply(p); };

// Spribe's Aviator in the OLD (game_list/) catalog — no longer on the site.
const LEGACY_AVIATOR = "a04d1f3eb8ccec8a4823bdf18e3f0e84";

beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.OCTHERA_API_KEY = "test-key";
  for (const k of ["OCTHERA_BASE_URL", "GAME_CATALOG", "OCTHERA_GAMES_PUBLIC", "OCTHERA_AVIATOR_PUBLIC"]) delete process.env[k];
  resetCatalogCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCatalogCache();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("import (syncCatalog)", () => {
  test("first import: every page, every game, sorted into sections; old catalog backed up", async () => {
    serve(makeCatalog());
    const r = await syncCatalog();

    expect(r).toMatchObject({ ok: true, complete: true, pages: 3, total: 456, fetched: 456, added: 456, active: 456, error: null });
    expect(r.sections).toEqual({
      casino: { slots: 300, live: 40, table: 30 },
      games: { crash: 35, fishing: 20, lottery: 15, arcade: 5, other: 1 },
      sports: { sportsbook: 6, virtual: 4 },
    });
    expect(r.unknownTypes).toEqual({ Specialty: 1 });
    expect(await prisma.catalogGame.count()).toBe(456);

    // The old catalog, backed up before it left the site.
    const backups = await prisma.catalogBackup.findMany();
    expect(backups).toHaveLength(1);
    expect(backups[0].gameCount).toBe(loadLegacyFiles().length);
    expect(backups[0].gameCount).toBeGreaterThan(1000);
    expect((backups[0].data as { gameID: string }[]).some((g) => g.gameID === LEGACY_AVIATOR)).toBe(true);

    const log = await prisma.catalogSync.findFirstOrThrow();
    expect(log).toMatchObject({ ok: true, complete: true, fetched: 456, added: 456 });
  });

  test("re-import: no duplicates, no second backup; changed names/images are updated in place", async () => {
    serve(makeCatalog());
    await syncCatalog();
    const changed = makeCatalog();
    changed[0] = { ...changed[0], name: "Sweet Fortune Deluxe", img: "https://cdn.octhera.test/new.webp" };
    serve(changed);
    const r = await syncCatalog();

    expect(r).toMatchObject({ ok: true, added: 0, updated: 1, deactivated: 0, active: 456 });
    expect(await prisma.catalogGame.count()).toBe(456);
    expect(await prisma.catalogBackup.count()).toBe(1);
    expect(await prisma.catalogGame.findUniqueOrThrow({ where: { id: `octhera:${changed[0].gameUid}` } }))
      .toMatchObject({ name: "Sweet Fortune Deluxe", img: "https://cdn.octhera.test/new.webp" });
  });

  test("a game Octhera drops is deactivated (row kept); it comes back if Octhera lists it again", async () => {
    const all = makeCatalog();
    serve(all);
    await syncCatalog();

    serve(all.slice(1));
    expect(await syncCatalog()).toMatchObject({ complete: true, deactivated: 1, active: 455 });
    const gone = await prisma.catalogGame.findUniqueOrThrow({ where: { id: `octhera:${all[0].gameUid}` } });
    expect(gone.active).toBe(false);
    expect(gone.deactivatedAt).not.toBeNull();

    serve(all);
    expect(await syncCatalog()).toMatchObject({ reactivated: 1, active: 456 });
  });

  test("an incomplete fetch never takes games off the site", async () => {
    serve(makeCatalog());
    await syncCatalog();

    const [p1] = pages(makeCatalog());
    reply(p1);
    reply({ status: "fail", message: "rate limited" }, 429);
    const r = await syncCatalog();
    expect(r).toMatchObject({ ok: true, complete: false, fetched: 200, deactivated: 0, active: 456 });
  });

  test("Octhera refusing page 1 → import fails, nothing touched", async () => {
    serve(makeCatalog());
    await syncCatalog();
    reply({ status: "fail", message: "invalid api key" }, 401);
    const r = await syncCatalog();
    expect(r).toMatchObject({ ok: false, error: "Octhera 401: invalid api key" });
    expect(await prisma.catalogGame.count({ where: { active: true } })).toBe(456);
  });
});

describe("the site's lists", () => {
  async function imported() {
    serve(makeCatalog());
    await syncCatalog();
    await loadGames();
  }

  test("sections and tabs come from the catalog; only the Octhera catalog is shown", async () => {
    await imported();
    expect(getSectionGames("casino")).toHaveLength(370);
    expect(getSectionGames("games")).toHaveLength(76);
    // Classified as sports, but not on the site: the sportsbook is the original one.
    expect(getSectionGames("sports")).toEqual([]);
    expect(searchGames("betting")).toEqual([]);
    expect(getSectionCategories("games").map((c) => [c.id, c.count])).toEqual([
      ["crash", 35], ["fishing", 20], ["lottery", 15], ["arcade", 5], ["other", 1],
    ]);
    expect(getSectionCategories("sports")).toEqual([]);

    // The old catalog is off the site…
    expect(getGamesByIds([LEGACY_AVIATOR])).toEqual([]);
    expect(searchGames("aviator").map((g) => g.gameID)).toEqual(["octhera:crash-0"]);
    // …but old bets and tickets keep their game names.
    expect(getGameNamesForHistory([LEGACY_AVIATOR, "octhera:crash-1"])).toEqual(
      new Map([["octhera:crash-1", "Mines"], [LEGACY_AVIATOR, "Aviator"]])
    );

    // Lobby rails are casino titles only — no sportsbook, crash or fishing games.
    expect(getHotGames(1000).every((g) => g.section === "casino" && g.category !== "live")).toBe(true);
    expect(getCategoryCounts()).toMatchObject({ all: 446, slots: 300, live: 40, table: 30, crash: 35 });
    expect(getPopularGames().slice(0, 2).map((g) => g.gameNameEn)).toEqual(["Aviator", "Mines"]);
  });

  test("providers: names, ids and per-section filters", async () => {
    await imported();
    expect(getProviderStats("casino").map((p) => p.slug).sort()).toEqual(["evolution", "jili", "pragmatic", "spribe"]);
    expect(getProviderStats("sports")).toEqual([]);
    expect(getGamesByProvider("betby")).toEqual([]);
    // A provider we already had a page for keeps its slug (/casino/spribe).
    expect(getGamesByProvider("spribe").some((g) => g.gameNameEn === "Aviator")).toBe(true);
    // Search by provider name.
    expect(searchGames("evolution", 1000).length).toBeGreaterThan(0);

    const [aviator] = getGamesByIds(["octhera:crash-0"]);
    expect(aviator).toMatchObject({
      gameID: "octhera:crash-0", gameNameEn: "Aviator", provider: "spribe", providerName: "Spribe",
      vendorCode: "SPRIBE", section: "games", category: "crash", type: "Crash",
      img: "https://cdn.octhera.test/games/crash-0.webp",
    });
  });

  test("every game has an image: Octhera's own, else its /media artwork", async () => {
    await imported();
    const all = [...getSectionGames("casino"), ...getSectionGames("games")];
    expect(all.every((g) => /^https:\/\//.test(g.img))).toBe(true);
    expect(getGamesByIds(["octhera:fishing-0"])[0].img).toBe("https://api.octhera.org/media/games/fishing-0");
  });

  test("first visit with an empty catalog imports it; Octhera down later keeps the last import", async () => {
    serve(makeCatalog());
    await loadGames();
    expect(getSectionGames("casino")).toHaveLength(370);

    // An hour later Octhera is down: the site still shows everything.
    await prisma.catalogSync.updateMany({ data: { startedAt: new Date(Date.now() - 2 * 3_600_000) } });
    resetCatalogCache();
    fetchMock.mockRejectedValue(new Error("network"));
    await loadGames();
    expect(getSectionGames("casino")).toHaveLength(370);
  });

  test("GAME_CATALOG=legacy puts the old catalog back", async () => {
    await imported();
    process.env.GAME_CATALOG = "legacy";
    expect(getGamesByIds([LEGACY_AVIATOR])).toHaveLength(1);
    expect(getGamesByIds(["octhera:crash-0"])).toEqual([]);
  });
});

describe("launch", () => {
  const open = (game_uid: string) =>
    gamesLaunch(req("POST", "/api/games/launch", { body: { game_uid }, headers: { "user-agent": "Mozilla/5.0 (Windows)" } }));

  async function imported() {
    serve(makeCatalog());
    await syncCatalog();
    resetCatalogCache();
  }

  test("a casino title launches through Octhera with the player's id and balance", async () => {
    await imported();
    const player = await makeUser({ balance: 120 });
    asUser({ id: player.id });
    reply({ status: "ok", launchUrl: "https://api.octhera.org/play?token=x" });

    const { status, body } = await json<{ game_launch_url: string; open: string }>(await open("octhera:slots-7"));
    expect(status).toBe(200);
    expect(body).toEqual({ game_launch_url: "https://api.octhera.org/play?token=x"});
    const launch = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/players/launch"))!;
    expect(JSON.parse(launch[1].body)).toEqual({ playerId: player.id, balance: 120, gameUid: "slots-7", lang: "en", device: "desktop" });
    expect(await prisma.recentGame.count({ where: { userId: player.id, gameId: "octhera:slots-7" } })).toBe(1);
  });

  test("Octhera's sports content can't be launched (the sportsbook is the original one)", async () => {
    await imported();
    asUser({ id: (await makeUser()).id });
    expect((await open("octhera:sportsbook-0")).status).toBe(502);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/players/launch"))).toBe(false);
  });

  test("an old-catalog game → 'no longer available', never launched", async () => {
    await imported();
    asUser({ id: (await makeUser()).id });
    const res = await open(LEGACY_AVIATOR);
    expect(res.status).toBe(410);
    expect((await json<{ unavailable: boolean }>(res)).body.unavailable).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/players/launch"))).toBe(false);
  });

  test("the sportsbook still opens through the main provider, as before", async () => {
    await imported();
    process.env.GAME_PROVIDER = "gregmorn"; // kill switch off by default → mock URL, provider never called
    process.env.GREGMORN_USER_ID = "00000000-0000-0000-0000-00000000test";
    process.env.GREGMORN_SECRET_KEY = "test-gregmorn-hmac-secret";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    delete process.env.GREGMORN_LIVE;
    asUser({ id: (await makeUser()).id });
    const res = await open(SPORTSBOOK_GAME_UID);
    expect(res.status).toBe(200);
    expect((await json<{ game_launch_url: string }>(res)).body.game_launch_url).toBeTruthy();
  });

  test("a game Octhera dropped → unavailable", async () => {
    const all = makeCatalog();
    serve(all);
    await syncCatalog();
    serve(all.slice(1));
    await syncCatalog();
    resetCatalogCache();
    asUser({ id: (await makeUser()).id });
    expect((await open(`octhera:${all[0].gameUid}`)).status).toBe(502);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/players/launch"))).toBe(false);
  });
});

describe("POST /api/cron/catalog-sync", () => {
  test("needs CRON_SECRET; answers what was imported", async () => {
    expect((await cronSync(req("POST", "/api/cron/catalog-sync", { headers: { "x-cron-secret": "nope" } }))).status).toBe(401);

    serve(makeCatalog());
    const { status, body } = await json<{ ok: boolean; active: number; complete: boolean }>(
      await cronSync(req("POST", "/api/cron/catalog-sync", { headers: { "x-cron-secret": process.env.CRON_SECRET! } }))
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, complete: true, active: 456 });
  });
});
