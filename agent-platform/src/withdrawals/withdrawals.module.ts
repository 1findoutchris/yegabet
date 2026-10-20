import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "../ledger/ledger";
import { LedgerModule } from "../ledger/ledger.module";
import { ENV } from "../tokens";
import { Withdrawals } from "./withdrawals";
import { WithdrawalsController } from "./withdrawals.controller";

/**
 * Every 15 minutes: unpaid past the SLA → escalated; paid but unanswered past
 * the auto-complete window → completed (plan 06). In-process, one replica;
 * off in tests (they call runSla directly).
 */
@Injectable()
export class WithdrawalSlaJob implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger("withdrawals");

  constructor(
    private readonly withdrawals: Withdrawals,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), 15 * 60 * 1000);
    void this.tick();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    try {
      const { escalated, completed } = await this.withdrawals.runSla();
      if (escalated + completed > 0) this.log.log(`SLA: ${escalated} escalated, ${completed} auto-completed`);
    } catch (e) {
      this.log.warn(`SLA run failed: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [LedgerModule],
  controllers: [WithdrawalsController],
  providers: [
    {
      provide: Withdrawals,
      inject: [PrismaService, Ledger, ENV],
      // Same keys as phones/deposits, separated by the hash domain withdrawal-ref:<method>.
      useFactory: (db: PrismaService, ledger: Ledger, env: Env) =>
        new Withdrawals(db, ledger, { hashKey: env.PHONE_HASH_KEY, encKey: env.PHONE_ENC_KEY }),
    },
    WithdrawalSlaJob,
  ],
})
export class WithdrawalsModule {}
