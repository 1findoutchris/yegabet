import { beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPlayedPopular, takeFresh } from "@/lib/homeSections";
import { SPORTSBOOK_GAME_UID } from "@/types/games";
import { makeUser, truncateAll } from "../factories";

/*
 * Lobby "Popular now": ranked by how many different players launched a game
 * in the last 30 days, from recent_games — never a shuffle. Too little data
 * and the section is hidden (empty list).
 */

// The catalog itself is covered by catalog.test.ts; here every id is "in the
// catalog" except one, so the ranking query is what's under test.
const RETIRED = "retired-game";
vi.mock("@/lib/games", () => ({
  catalogMode: () => "octhera",
  getGamesByIds: (ids: string[]) => ids.filter((id) => id !== RETIRED).map((gameID) => ({ gameID })),
}));

const G = ["f0980130e62b9465a069bf337d4ace74", "be63ff4b42188d4a87fd7c40f342ee5d", "6a5c65a0d36aa53a0e67f5fd7ac8fef8",
  "4652a761c9f9c182b5483174a8968a97", "dc61b111e441a25c7d2fc74634ad8976", "6279dabb6b13ef5891c29481dd07474f"];

const play = (userId: string, gameId: string, playCount = 1, daysAgo = 0) =>
  prisma.recentGame.create({ data: { userId, gameId, playCount, lastPlayedAt: new Date(Date.now() - daysAgo * 86_400_000) } });

describe("homepage sections", () => {
  beforeAll(truncateAll);

  test("popular is hidden until enough games have been played", async () => {
    const u = await makeUser({});
    for (const g of G.slice(0, 3)) await play(u.id, g);
    expect(await getPlayedPopular(10)).toEqual([]);
  });

  test("ranks by distinct players, then launches; ignores old plays and the sportsbook", async () => {
    await prisma.recentGame.deleteMany();
    const [a, b, c] = await Promise.all([makeUser({}), makeUser({}), makeUser({})]);
    for (const u of [a, b, c]) await play(u.id, G[3]);        // 3 players
    for (const u of [a, b]) await play(u.id, G[1]);           // 2 players
    await play(a.id, G[0], 50);                               // 1 player, many launches
    await play(a.id, G[2], 2);                                // 1 player, fewer
    await play(b.id, G[4], 99, 40);                           // outside the window
    for (const u of [a, b, c]) await play(u.id, SPORTSBOOK_GAME_UID);
    for (const u of [a, b, c]) await play(u.id, RETIRED);     // no longer in the catalog
    const ids = (await getPlayedPopular(10)).map((g) => g.gameID);
    expect(ids).toEqual([G[3], G[1], G[0], G[2]]);
  });

  test("takeFresh never repeats a game across sections", () => {
    const seen = new Set<string>();
    const games = G.map((gameID) => ({ gameID })) as Parameters<typeof takeFresh>[0];
    expect(takeFresh(games.slice(0, 4), 3, seen).map((g) => g.gameID)).toEqual(G.slice(0, 3));
    expect(takeFresh(games, 2, seen).map((g) => g.gameID)).toEqual([G[3], G[4]]);
  });
});
