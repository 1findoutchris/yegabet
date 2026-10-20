import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "../config/env";
import { configAt } from "../config/configVersions";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "../ledger/ledger";
import { LedgerModule } from "../ledger/ledger.module";
import { ENV } from "../tokens";
import { GameWallet } from "./gameWallet";
import { Games } from "./games";
import { OctheraClient } from "./octhera/client";
import { GamesController, OctheraWalletController } from "./providers.controller";

/** The Octhera API client, or null until OCTHERA_API_KEY is set (catalog/launch then answer 503). */
export function octheraClientFor(
  env: Pick<Env, "OCTHERA_API_KEY" | "OCTHERA_BASE_URL">,
): OctheraClient | null {
  return env.OCTHERA_API_KEY ? new OctheraClient(env.OCTHERA_API_KEY, env.OCTHERA_BASE_URL) : null;
}

/**
 * Hourly: import the catalog (when configured) and settle bets left open
 * past the configured hours as lost (Q-35). In-process, one replica; off in tests.
 */
@Injectable()
export class ProviderJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger("providers");

  constructor(
    private readonly games: Games,
    private readonly wallet: GameWallet,
    private readonly db: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.env.OCTHERA_API_KEY) {
      try {
        const r = await this.games.importCatalog();
        this.log.log(
          `catalog: ${r.fetched} games${r.complete ? "" : " (INCOMPLETE)"}, ${r.deactivated} deactivated`,
        );
      } catch (e) {
        this.log.warn(`catalog import failed: ${(e as Error).message}`);
      }
    }
    try {
      const hours = (await configAt(this.db, "bets.auto_settle_hours", new Date()))?.value;
      if (typeof hours === "number" && hours > 0) {
        const n = await this.wallet.autoSettle(hours);
        if (n > 0) this.log.log(`settled ${n} open bet(s) as lost`);
      }
    } catch (e) {
      this.log.warn(`auto-settle failed: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [LedgerModule],
  controllers: [OctheraWalletController, GamesController],
  providers: [
    {
      provide: GameWallet,
      inject: [PrismaService, Ledger],
      useFactory: (db: PrismaService, l: Ledger) => new GameWallet(db, l),
    },
    {
      provide: Games,
      inject: [PrismaService, ENV],
      useFactory: (db: PrismaService, env: Env) => new Games(db, octheraClientFor(env)),
    },
    ProviderJobs,
  ],
  exports: [GameWallet],
})
export class ProvidersModule {}
