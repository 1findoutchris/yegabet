import { DynamicModule, Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import type { Env } from "./config/env";
import { PrismaService } from "./db/prisma.service";
import { HealthController } from "./health/health.controller";
import { LedgerModule } from "./ledger/ledger.module";
import { ENV } from "./tokens";
import { PermissionGuard } from "./auth/guard";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { DepositsModule } from "./deposits/deposits.module";
import { WithdrawalsModule } from "./withdrawals/withdrawals.module";
import { ProvidersModule } from "./providers/providers.module";
import { SettlementModule } from "./settlement/settlement.module";

/** Never log these in plain text (CLAUDE.md §7). */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.phone",
  "*.token",
  "*.password",
  "*.reference",
  "*.initData",
];

@Global()
@Module({})
class CoreModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: ENV, useValue: env }, PrismaService],
      exports: [ENV, PrismaService],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: { paths: REDACT_PATHS, censor: "[redacted]" },
            transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
          },
        }),
        LedgerModule,
        UsersModule,
        AuthModule,
        DepositsModule,
        WithdrawalsModule,
        ProvidersModule,
        SettlementModule,
      ],
      controllers: [HealthController],
      // Deny by default: every route needs @Public() or @Requires(...).
      providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
    };
  }
}
