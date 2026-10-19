import { Module } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "../ledger/ledger";
import { LedgerModule } from "../ledger/ledger.module";
import { ENV } from "../tokens";
import { Hierarchy } from "./hierarchy";
import { Players } from "./players";

/** Internal services only; no public routes in Task 03. */
@Module({
  imports: [LedgerModule],
  providers: [
    {
      provide: Hierarchy,
      inject: [PrismaService, Ledger],
      useFactory: (db: PrismaService, ledger: Ledger) => new Hierarchy(db, ledger),
    },
    {
      provide: Players,
      inject: [PrismaService, Ledger, ENV],
      useFactory: (db: PrismaService, ledger: Ledger, env: Env) =>
        new Players(db, ledger, { hashKey: env.PHONE_HASH_KEY, encKey: env.PHONE_ENC_KEY }),
    },
  ],
  exports: [Hierarchy, Players],
})
export class UsersModule {}
