import type { PrismaClient } from "@prisma/client";
import { Ledger } from "../../src/ledger/ledger";
import { Games } from "../../src/providers/games";
import type { OctheraClient, OctheraGame } from "../../src/providers/octhera/client";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

jest.setTimeout(120_000);

let db: PrismaClient;
let catalog: OctheraGame[] = [];
const client = {
  listGames: async (page: number) => ({ total: catalog.length, games: page === 1 ? catalog : [] }),
} as unknown as OctheraClient;
let games: Games;
const p = `${process.pid}`;
const uid = (s: string) => `lobby-${p}-${s}`;
const PROV = `Lobby Studio ${p}`;
const prov = `lobby-studio-${p}`;

beforeAll(async () => {
  db = testPrisma();
  games = new Games(db, client);
  catalog = [
    { gameUid: uid("slot1"), name: "Sweet Bonanza", type: "Slots", providerName: PROV },
    { gameUid: uid("slot2"), name: "Book of Dead", type: "Video Slot", providerName: PROV },
    { gameUid: uid("crash1"), name: "Aviator", type: "Crash", providerName: PROV },
    { gameUid: uid("live1"), name: "Lightning Roulette", type: "Casino Live", providerName: PROV },
    { gameUid: uid("table1"), name: "European Roulette", type: "Table Games", providerName: PROV },
    { gameUid: uid("sport1"), name: "Sportsbook", type: "Sportsbook", providerName: PROV },
    { gameUid: uid("odd1"), name: "Wonder Wheel", type: "Specialty", provider: `Other ${p}` },
  ];
  await games.importCatalog();
});
afterAll(() => db.$disconnect());

it("stores each game's lobby place and provider slug, keeping when it was first seen", async () => {
  const row = (s: string) =>
    db.game.findUniqueOrThrow({ where: { providerId_gameUid: { providerId: "octhera", gameUid: uid(s) } } });
  expect(await row("slot1")).toMatchObject({ section: "casino", category: "slots", providerSlug: prov });
  expect(await row("crash1")).toMatchObject({ section: "games", category: "crash" });
  expect(await row("live1")).toMatchObject({ section: "casino", category: "live" });
  expect(await row("sport1")).toMatchObject({ section: "sports", category: "sportsbook" });
  expect(await row("odd1")).toMatchObject({
    section: "games",
    category: "other",
    providerSlug: `other-${p}`,
  });
  const first = (await row("slot1")).firstSeenAt;
  await games.importCatalog();
  expect((await row("slot1")).firstSeenAt).toEqual(first);
});

it("lists by category, section and provider, and never lists sports", async () => {
  const names = async (q: Record<string, string>) =>
    (await games.list({ provider: prov, ...q })).games.map((g) => g.name).sort();
  expect(await names({ category: "slots" })).toEqual(["Book of Dead", "Sweet Bonanza"]);
  expect(await names({ section: "casino" })).toEqual([
    "Book of Dead",
    "European Roulette",
    "Lightning Roulette",
    "Sweet Bonanza",
  ]);
  expect(await names({})).not.toContain("Sportsbook");
  expect(await names({ section: "sports" })).toEqual([]);
  expect((await games.list({ provider: prov, search: "aviat" })).games[0]).toMatchObject({
    name: "Aviator",
    category: "crash",
    providerSlug: prov,
  });
});

it("builds the lobby: counts, providers, rows without repeats, popular from real bets", async () => {
  // Make Aviator the most played game this month.
  const ledger = new Ledger(db);
  const agent = await new Hierarchy(db, ledger).createAgent({ slug: `lobby-a-${p}`, displayName: "L" });
  const player = await new Players(db, ledger, PHONE_KEY_PAIR).register({
    phone: "+251977000001",
    referralSlug: agent.slug,
  });
  for (let i = 0; i < 3; i++) {
    await db.bet.create({
      data: {
        providerId: "octhera",
        playerId: player.id,
        agentId: agent.id,
        gameUid: uid("crash1"),
        debitTxnId: `lobby-${p}-${i}`,
        stake: 100n,
      },
    });
  }
  await db.bet.create({
    data: {
      providerId: "octhera",
      playerId: player.id,
      agentId: agent.id,
      gameUid: uid("slot2"),
      debitTxnId: `lobby-${p}-s`,
      stake: 100n,
    },
  });

  const lobby = await games.lobby();
  expect(lobby.counts.slots).toBeGreaterThanOrEqual(2);
  expect(lobby.counts.live).toBeGreaterThanOrEqual(1);
  expect(lobby.counts.crash).toBeGreaterThanOrEqual(1);
  expect(lobby.counts.other).toBeGreaterThanOrEqual(1);
  expect(lobby.providers.find((x) => x.slug === prov)).toEqual({ slug: prov, name: PROV, count: 4 }); // casino games only
  expect(lobby.rows.popular.slice(0, 2).map((g) => g.gameUid)).toEqual([uid("crash1"), uid("slot2")]);

  const all = Object.values(lobby.rows)
    .flat()
    .map((g) => g.gameUid);
  expect(new Set(all).size).toBe(all.length); // no game twice
  expect(lobby.rows.crash.map((g) => g.gameUid)).not.toContain(uid("crash1")); // already in Popular
  expect(all).not.toContain(uid("sport1"));
});

it("caps each row at 16 games", async () => {
  catalog = Array.from({ length: 20 }, (_, i) => ({
    gameUid: uid(`many${i}`),
    name: `Many Slots ${i}`,
    type: "Slots",
    providerName: PROV,
  }));
  await games.importCatalog();
  const lobby = await games.lobby();
  expect(lobby.rows.slots).toHaveLength(16);
  expect(lobby.rows.new.length).toBeLessThanOrEqual(16);
});
