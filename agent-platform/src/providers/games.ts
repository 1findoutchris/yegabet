import type { Game, Prisma, PrismaClient } from "@prisma/client";
import { isEnabled } from "../config/featureFlags";
import { classify, slugify } from "./classify";
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
        const providerName = g.providerName ?? g.provider ?? null;
        // The old site's lobby placement (plan 12): section + category from type, then name.
        const place = classify(g.type, g.name);
        const data = {
          name: g.name.slice(0, 200),
          providerName,
          providerSlug: providerName ? slugify(providerName) : null,
          section: place.section,
          category: place.category,
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

  /**
   * One page of active games, filtered by category, section, provider or a
   * name search. Sports games are never listed: the new platform has no
   * sportsbook (plan 12).
   */
  async list(q: {
    type?: unknown;
    search?: unknown;
    page?: unknown;
    category?: unknown;
    section?: unknown;
    provider?: unknown;
  }) {
    const page = Math.max(1, Math.min(500, Number(q.page) || 1));
    const str = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 50) : undefined);
    const where: Prisma.GameWhereInput = {
      active: true,
      section: str(q.section) ?? { not: "sports" },
      ...(str(q.type) ? { type: str(q.type) } : {}),
      ...(str(q.category) ? { category: str(q.category) } : {}),
      ...(str(q.provider) ? { providerSlug: str(q.provider) } : {}),
      ...(str(q.search) ? { name: { contains: str(q.search), mode: "insensitive" as const } } : {}),
    };
    if (where.section === "sports") where.section = "__none__";
    const [total, rows] = await Promise.all([
      this.db.game.count({ where }),
      this.db.game.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * 60, take: 60 }),
    ]);
    return { total, page, games: rows.map(gameView) };
  }

  /**
   * Everything the lobby shows, in one call (plan 12): category counts, casino
   * providers with counts, and the rows. Rows are filled top to bottom and a
   * game shown in one row isn't repeated further down, as on the old site.
   */
  async lobby() {
    const active = { active: true, section: { not: "sports" } };
    const counts = await this.db.game.groupBy({
      by: ["section", "category"],
      where: active,
      _count: { _all: true },
    });
    const count = (category: string) =>
      counts.filter((c) => c.category === category).reduce((s, c) => s + c._count._all, 0);
    const providers = await this.db.game.groupBy({
      by: ["providerSlug", "providerName"],
      where: { ...active, section: "casino", providerSlug: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { providerSlug: "desc" } },
      take: 24,
    });

    const since = new Date(Date.now() - 30 * 86_400_000);
    const played = await this.db.bet.groupBy({
      by: ["gameUid"],
      where: { providerId: PROVIDER, placedAt: { gte: since }, gameUid: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { gameUid: "desc" } },
      take: 64,
    });
    const popularRows = await this.db.game.findMany({
      where: { ...active, gameUid: { in: played.map((p) => p.gameUid as string) } },
    });
    const rank = new Map(played.map((p, i) => [p.gameUid, i]));
    popularRows.sort((a, b) => (rank.get(a.gameUid) as number) - (rank.get(b.gameUid) as number));

    const byCategory = (category: string) =>
      this.db.game.findMany({ where: { ...active, category }, orderBy: { name: "asc" }, take: 60 });
    const [crash, slots, live, table, recent] = await Promise.all([
      byCategory("crash"),
      byCategory("slots"),
      byCategory("live"),
      byCategory("table"),
      this.db.game.findMany({ where: active, orderBy: { firstSeenAt: "desc" }, take: 60 }),
    ]);

    const seen = new Set<string>();
    const fresh = (rows: { gameUid: string }[], n = 16) => {
      const out = [];
      for (const r of rows) {
        if (out.length >= n) break;
        if (seen.has(r.gameUid)) continue;
        seen.add(r.gameUid);
        out.push(r);
      }
      return out as typeof rows;
    };
    return {
      counts: {
        slots: count("slots"),
        live: count("live"),
        table: count("table"),
        crash: count("crash"),
        fishing: count("fishing"),
        lottery: count("lottery"),
        arcade: count("arcade"),
        other: count("other"),
      },
      providers: providers.map((p) => ({
        slug: p.providerSlug as string,
        // The slug is made from the name, so a provider with a slug has a name.
        name: p.providerName as string,
        count: p._count._all,
      })),
      rows: {
        popular: (fresh(popularRows) as typeof popularRows).map(gameView),
        crash: (fresh(crash) as typeof crash).map(gameView),
        slots: (fresh(slots) as typeof slots).map(gameView),
        live: (fresh(live) as typeof live).map(gameView),
        new: (fresh(recent) as typeof recent).map(gameView),
        table: (fresh(table) as typeof table).map(gameView),
      },
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

function gameView(g: Game) {
  return {
    provider: g.providerId,
    gameUid: g.gameUid,
    name: g.name,
    providerName: g.providerName,
    providerSlug: g.providerSlug,
    section: g.section,
    category: g.category,
    type: g.type,
    img: g.img,
  };
}
