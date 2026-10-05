import "server-only";
import fs from "fs";
import path from "path";
import type { Game } from "@/types/games";

/*
 * The pre-Octhera catalog: the game_list/ (Silent) or game_list-gregmorn/
 * JSON files. Off the site since the Octhera catalog replaced it; kept for
 *   - the backup written by the first Octhera import (catalog_backups)
 *   - rollback: GAME_CATALOG=legacy puts these lists back (lib/games)
 *   - history: old tickets and bets still show these games' names
 */

// Which catalog is loaded — hidden lists are provider-account specific.
export const CATALOG_DIR = process.env.GAME_LIST_DIR || "game_list";
const IS_GREGMORN_CATALOG = CATALOG_DIR.includes("gregmorn");

// Gregmorn: sportsbooks launch through the sports pane, never as casino tiles.
// Everything else in their ETB feed is enabled for our account.
const GREGMORN_HIDDEN_PROVIDERS = new Set([
  "sports-betby",
  "sportslab",
  "sportshub",
  "altenar",
]);

// Silent: disabled providers — hidden everywhere (they don't accept our
// currency / aren't working). Their games are filtered out of every list.
const SILENT_HIDDEN_PROVIDERS = new Set([
  "jili",
  "hacksaw-asia",
  "cq9",
  "jdb",
  "2j",
  "btgaming",
  "5ggaming",
  "wonwon",
  "evolutionlive-asia",
  "playtech",
  "microgaming",
  "playngo",
  "mac88_en",
  "bgaming",
  "skywind",
  "relaxgaming",
  "bng",
  "bng-asia",
  "nolimitcity",
  "nolimitcity-asia",
  "gameart",
  "ace",
  "pgsgaming",
  "ygrgaming",
  "ws168_en",
]);

export const HIDDEN_PROVIDERS = IS_GREGMORN_CATALOG ? GREGMORN_HIDDEN_PROVIDERS : SILENT_HIDDEN_PROVIDERS;

function parseGameFile(raw: string, providerSlug: string): Game[] {
  try {
    const parsed = JSON.parse(raw);
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.gameLists)
      ? parsed.gameLists
      : [];

    return list
      .filter((g: unknown) => {
        const game = g as Record<string, unknown>;
        // Only skip if the entry has no ID or name — images optional
        return !!(game.gameID && game.gameNameEn);
      })
      .map((g: unknown) => {
        const game = g as Record<string, unknown>;
        return {
          gameID: game.gameID as string,
          gameNameEn: game.gameNameEn as string,
          img: (game.img as string) || "",
          customGameType: Number(game.customGameType ?? 0),
          vendorCode: (game.vendorCode ?? providerSlug) as string | number,
          provider: providerSlug,
        };
      });
  } catch {
    return [];
  }
}

let _files: Game[] | null = null;

/** Every game in the legacy files, hidden providers included. */
export function loadLegacyFiles(): Game[] {
  if (_files) return _files;
  // Catalog dir is switchable: game_list (Silent) is the default;
  // game_list-gregmorn is written by scripts/sync-gregmorn-games.mjs.
  const dir = path.join(process.cwd(), CATALOG_DIR);
  if (!fs.existsSync(dir)) return (_files = []);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const all: Game[] = [];
  for (const file of files) {
    const slug = file.replace(".json", "");
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    all.push(...parseGameFile(raw, slug));
  }
  return (_files = all);
}

/** Names of legacy games, for history (tickets, bets) only — never for playing. */
export function legacyGameNames(ids: string[]): Map<string, string> {
  const want = new Set(ids);
  const out = new Map<string, string>();
  if (!want.size) return out;
  for (const g of loadLegacyFiles()) if (want.has(g.gameID)) out.set(g.gameID, g.gameNameEn);
  return out;
}

/**
 * Snapshot the legacy catalog into catalog_backups — once. Every game in the
 * files, with whether it was shown (hidden = its provider was switched off).
 * The files themselves stay in the repo too.
 */
export async function backupLegacyCatalog(): Promise<{ created: boolean; gameCount: number }> {
  const { prisma } = await import("@/lib/prisma");
  const source = `legacy:${CATALOG_DIR}`;
  const existing = await prisma.catalogBackup.findFirst({ where: { source }, select: { gameCount: true } });
  if (existing) return { created: false, gameCount: existing.gameCount };

  const games = loadLegacyFiles();
  const data = games.map((g) => ({
    gameID: g.gameID,
    name: g.gameNameEn,
    provider: g.provider,
    img: g.img,
    customGameType: g.customGameType,
    hidden: HIDDEN_PROVIDERS.has(g.provider),
  }));
  await prisma.catalogBackup.create({
    data: {
      label: `Catalog before the Octhera import (${CATALOG_DIR}/)`,
      source,
      gameCount: data.length,
      data,
    },
  });
  console.log(`[catalog] backed up the old catalog: ${data.length} games from ${CATALOG_DIR}/`);
  return { created: true, gameCount: data.length };
}
