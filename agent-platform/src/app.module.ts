import { DynamicModule, Global, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { Env } from "./config/env";
import { PrismaService } from "./db/prisma.service";
import { HealthController } from "./health/health.controller";
import { LedgerModule } from "./ledger/ledger.module";
import { ENV } from "./tokens";

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
      ],
      controllers: [HealthController],
    };
  }
}
