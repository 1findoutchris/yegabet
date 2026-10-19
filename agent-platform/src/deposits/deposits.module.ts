import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "../ledger/ledger";
import { LedgerModule } from "../ledger/ledger.module";
import { ENV } from "../tokens";
import { Deposits } from "./deposits";
import { DepositsController } from "./deposits.controller";

/**
 * Hourly: pending deposits past their TTL become "expired" (Q-30). In-process
 * timer, fine for one replica; it moves to a queue with Redis (Task 06+).
 * Off in tests (they call expireStale directly).
 */
@Injectable()
export class DepositExpiryJob implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger("deposits");

  constructor(
    private readonly deposits: Deposits,
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
    try {
      const n = await this.deposits.expireStale();
      if (n > 0) this.log.log(`expired ${n} pending deposit(s)`);
    } catch (e) {
      this.log.warn(`expiry run failed: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [LedgerModule],
  controllers: [DepositsController],
  providers: [
    {
      provide: Deposits,
      inject: [PrismaService, Ledger, ENV],
      // Same keys as phone numbers, separated by a hash domain (deposit-ref:<method>).
      useFactory: (db: PrismaService, ledger: Ledger, env: Env) =>
        new Deposits(db, ledger, { hashKey: env.PHONE_HASH_KEY, encKey: env.PHONE_ENC_KEY }),
    },
    DepositExpiryJob,
  ],
})
export class DepositsModule {}
