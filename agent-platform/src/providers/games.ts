import type { PrismaClient } from "@prisma/client";
import { isEnabled } from "../config/featureFlags";
import { PROVIDER, toProviderPlayerId } from "./octhera/adapter";
import type { OctheraClient } from "./octhera/client";

export const GAMES_FLAG = "games.open";
const PER_PAGE = 200;

export type GamesErrorCode = "CLOSED" | "NOT_CONFIGURED" | "NOT_FOUND" | "PLAYER_NOT_ALLOWED";

export class GamesError extends Error {
  constructor(
    readonly code: GamesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GamesError";
  }
}

/**
 * The game catalog and launching (plan 07). The catalog is imported from the
 * provider; a game that disappears is deactivated, never deleted, and only
 * after a complete import (a failed page takes nothing off the site).
 */
export class Games {
  constructor(
    private readonly db: PrismaClient,
    private readonly octhera: OctheraClient | null,
  ) {}

  /** Import every page. Returns counts; `complete` is false if paging stopped early. */
  async importCatalog(): Promise<{ fetched: number; deactivated: number; complete: boolean }> {
    if (!this.octhera) throw new GamesError("NOT_CONFIGURED", "OCTHERA_API_KEY is not set");
    const startedAt = new Date();
    let fetched = 0;
    let total = Infinity;
    for (let page = 1; fetched < total && page <= 200; page++) {
      const res = await this.octhera.listGames(page, PER_PAGE);
      total = typeof res.total === "number" ? res.total : 0;
      const games = res.games ?? [];
      for (const g of games) {
        if (!g?.gameUid || !g.name) continue;
        const data = {
          name: g.name.slice(0, 200),
          providerName: g.providerName ?? g.provider ?? null,
          type: g.type ?? null,
          img: g.img ?? null,
          active: true,
          syncedAt: new Date(),
        };
        await this.db.game.upsert({
          where: { providerId_gameUid: { providerId: PROVIDER, gameUid: g.gameUid } },
          create: { providerId: PROVIDER, gameUid: g.gameUid, ...data },
          update: data,
        });
      }
      fetched += games.length;
      if (games.length === 0) break;
    }
    const complete = fetched >= total;
    let deactivated = 0;
    if (complete && fetched > 0) {
      ({ count: deactivated } = await this.db.game.updateMany({
        where: { providerId: PROVIDER, active: true, syncedAt: { lt: startedAt } },
        data: { active: false },
      }));
    }
    return { fetched, deactivated, complete };
  }

  async list(q: { type?: unknown; search?: unknown; page?: unknown }) {
    const page = Math.max(1, Math.min(500, Number(q.page) || 1));
    const where = {
      active: true,
      ...(typeof q.type === "string" && q.type ? { type: q.type } : {}),
      ...(typeof q.search === "string" && q.search
        ? { name: { contains: q.search.slice(0, 50), mode: "insensitive" as const } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.game.count({ where }),
      this.db.game.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * 60, take: 60 }),
    ]);
    return {
      total,
      page,
      games: rows.map((g) => ({
        provider: g.providerId,
        gameUid: g.gameUid,
        name: g.name,
        providerName: g.providerName,
        type: g.type,
        img: g.img,
      })),
    };
  }

  /** A single-use launch URL for this player (their wallet balance goes along for display). */
  async launch(playerId: bigint, gameUid: string, device: unknown): Promise<string> {
    if (!(await isEnabled(this.db, GAMES_FLAG))) throw new GamesError("CLOSED", "games open soon");
    if (!this.octhera) throw new GamesError("NOT_CONFIGURED", "games are not configured");
    const game = await this.db.game.findUnique({
      where: { providerId_gameUid: { providerId: PROVIDER, gameUid } },
    });
    if (!game?.active) throw new GamesError("NOT_FOUND", "this game is not available");
    const player = await this.db.player.findUnique({
      where: { id: playerId },
      select: { status: true, agent: { select: { status: true } } },
    });
    if (player?.status !== "active" || player.agent.status !== "active") {
      throw new GamesError("PLAYER_NOT_ALLOWED", "this account can't play right now");
    }
    // Every registered player has a wallet with a balance row (Task 03 opens both).
    const wallet = await this.db.account.findFirstOrThrow({
      where: { type: "PLAYER_WALLET", ownerKind: "player", ownerId: playerId.toString() },
      select: { balance: { select: { balance: true } } },
    });
    const balance = Number((wallet.balance as { balance: bigint }).balance) / 100;
    return this.octhera.launch({
      playerId: toProviderPlayerId(playerId),
      balance,
      gameUid,
      device: device === "mobile" ? "mobile" : "desktop",
    });
  }
}
