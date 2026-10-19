import { Module } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service";
import { Ledger } from "./ledger";

/** Nest wiring for the framework-free ledger core. Internal only: no HTTP routes. */
@Module({
  providers: [
    { provide: Ledger, inject: [PrismaService], useFactory: (db: PrismaService) => new Ledger(db) },
  ],
  exports: [Ledger],
})
export class LedgerModule {}
