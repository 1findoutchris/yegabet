/*
 * A made-up Octhera v2 catalog (GET /games) for tests — the real one isn't
 * reachable from CI. Field names and types follow what the v2 API returns:
 * { gameUid, name, provider, providerName, type, img? }, 200 per page with
 * `total`. The type strings mix the ones seen so far ("Slots", "Crash",
 * "Casino Live") with plausible others, plus one we can't place.
 */

export interface FixtureGame {
  gameUid: string;
  name: string;
  provider: string;
  providerName: string;
  type: string;
  img?: string;
}

const PROVIDERS: [string, string][] = [
  ["PRAGMATIC", "Pragmatic Play"],
  ["SPRIBE", "Spribe"],
  ["EVOLUTION", "Evolution"],
  ["JILI", "JILI"],
  ["BETBY", "BetBy"],
];

/** 456 games: 300 slots, 40 live, 30 table, 35 crash, 20 fishing, 15 keno, 5 arcade, 6 sports, 4 virtual, 1 unknown. */
export function makeCatalog(): FixtureGame[] {
  const out: FixtureGame[] = [];
  const add = (n: number, type: string, name: (i: number) => string, p: number, img = true) => {
    for (let i = 0; i < n; i++) {
      const [provider, providerName] = PROVIDERS[(p + i) % (p === 4 ? 1 : 4)];
      const uid = `${type.toLowerCase().replace(/\W+/g, "-")}-${i}`;
      out.push({
        gameUid: uid, name: name(i), provider: p === 4 ? "BETBY" : provider,
        providerName: p === 4 ? "BetBy" : providerName, type,
        ...(img ? { img: `https://cdn.octhera.test/games/${uid}.webp` } : {}),
      });
    }
  };
  add(300, "Slots", (i) => `Sweet Fortune ${i}`, 0, true);
  add(40, "Casino Live", (i) => (i % 2 ? `Live Roulette ${i}` : `Live Blackjack ${i}`), 2);
  add(30, "Table Games", (i) => `Classic Baccarat ${i}`, 0);
  add(35, "Crash", (i) => (i === 0 ? "Aviator" : i === 1 ? "Mines" : `Rocket Rush ${i}`), 1);
  add(20, "Fishing", (i) => `Ocean King ${i}`, 3, false); // no img → Octhera's /media fallback
  add(15, "Keno", (i) => `Keno Draw ${i}`, 1);
  add(5, "Arcade", (i) => `Pixel Run ${i}`, 3);
  add(6, "Sportsbook", (i) => (i === 0 ? "Sportsbook" : `Live Betting ${i}`), 4);
  add(4, "Virtual Sports", (i) => `Virtual Football ${i}`, 4);
  add(1, "Specialty", () => "Wonder Wheel Deluxe", 0);
  return out;
}

/** Octhera's paged replies for a catalog: 200 per page, with `total`. */
export function pages(games: FixtureGame[], limit = 200) {
  const out: { status: "ok"; page: number; limit: number; total: number; count: number; games: FixtureGame[] }[] = [];
  for (let i = 0; i * limit < games.length || i === 0; i++) {
    const part = games.slice(i * limit, (i + 1) * limit);
    out.push({ status: "ok", page: i + 1, limit, total: games.length, count: part.length, games: part });
  }
  return out;
}
