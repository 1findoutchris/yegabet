/**
 * Sync the Gregmorn ETB game catalog into game_list-gregmorn/<provider>.json.
 *
 * Writes to a SEPARATE directory from game_list/ so nothing changes until
 * GAME_LIST_DIR=game_list-gregmorn is deployed alongside GAME_PROVIDER=gregmorn.
 * Self-contained plain Node — no src imports, no ts-node.
 *
 * Auth: catalog reads use the parent account's JWT (GREGMORN_LOGIN /
 * GREGMORN_PASSWORD). Tokens are single-session — a dashboard login supersedes
 * them — so this re-logins on every run rather than caching.
 *
 * Run:  GREGMORN_LOGIN=… GREGMORN_PASSWORD=… GREGMORN_USER_ID=… \
 *         node scripts/sync-gregmorn-games.mjs
 */
import fs from "fs";
import path from "path";

const OFFICE_URL = process.env.GREGMORN_OFFICE_URL ?? "https://office-api.gregmorn.org";
const USER_ID = process.env.GREGMORN_USER_ID;
const OUT_DIR = path.join(process.cwd(), process.env.GAME_LIST_DIR ?? "game_list-gregmorn");

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function login() {
  const res = await fetch(`${OFFICE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      login: process.env.GREGMORN_LOGIN,
      password: process.env.GREGMORN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  return (await res.json()).accessToken;
}

async function main() {
  const token = await login();
  const res = await fetch(`${OFFICE_URL}/users/${USER_ID}/getUserGames/ETB`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getUserGames ${res.status}: ${await res.text()}`);
  const games = await res.json();
  const enabled = games.filter((g) => g.isEnabled);
  console.log(`fetched ${games.length} games, ${enabled.length} enabled`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const byProvider = new Map();
  for (const g of enabled) {
    const slug = slugify(g.provider);
    if (!byProvider.has(slug)) byProvider.set(slug, []);
    byProvider.get(slug).push(g);
  }

  for (const [slug, list] of byProvider) {
    const mapped = list.map((g) => ({
      gameID: g.id,
      gameNameEn: g.title,
      img: g.imageUrl ?? "",
      // Slots rail filters customGameType 0 — only real slots qualify; table
      // games (roulette, blackjack, baccarat…) get 1.
      customGameType: g.category === "Slot" ? 0 : 1,
      vendorCode: g.provider,
      provider: slug,
      // Extra metadata kept for future categorization — parseGameFile ignores it.
      category: g.category ?? "",
    }));
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.json`), JSON.stringify(mapped, null, 1));
  }

  console.log(`wrote ${byProvider.size} provider files to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
