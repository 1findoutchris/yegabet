import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "../ledger/ledger";
import { LedgerModule } from "../ledger/ledger.module";
import { ENV } from "../tokens";
import { Settlement, SettlementError } from "./settlement";
import { ConfigController, SettlementController } from "./settlement.controller";

/**
 * Hourly: create periods that have started, and draft the oldest ended
 * period once every earlier one is approved. Approval is always a person's
 * (the owner). In-process, one replica; off in tests.
 */
@Injectable()
export class SettlementJob implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger("settlement");

  constructor(
    private readonly settlement: Settlement,
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

  async tick(now = new Date()): Promise<void> {
    try {
      await this.settlement.ensurePeriods(now);
      const next = (await this.settlement.list()).find((p) => p.status !== "approved");
      if (next && next.status === "open" && next.endsAt.getTime() <= now.getTime()) {
        await this.settlement.draft(next.id, null, now);
        this.log.log(`drafted settlement period ${next.id}; waiting for the owner's approval`);
      }
    } catch (e) {
      // No launch date yet is normal before go-live.
      if (e instanceof SettlementError && e.code === "RULES") return;
      this.log.warn(`settlement run failed: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [LedgerModule],
  controllers: [SettlementController, ConfigController],
  providers: [
    {
      provide: Settlement,
      inject: [PrismaService, Ledger],
      useFactory: (db: PrismaService, ledger: Ledger) => new Settlement(db, ledger),
    },
    SettlementJob,
  ],
})
export class SettlementModule {}
