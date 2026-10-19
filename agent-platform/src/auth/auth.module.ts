import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { SignupBot } from "../telegram/bot";
import { TELEGRAM_API, TelegramApi, TelegramController } from "../telegram/telegram.controller";
import { ENV } from "../tokens";
import { Players } from "../users/players";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { Auth } from "./auth.service";
import { PrincipalMiddleware } from "./principal.middleware";
import { Sessions } from "./sessions";

/** The Bot API client, or null until a bot token is configured (routes then answer 503). */
export function telegramApiFor(env: Pick<Env, "TELEGRAM_BOT_TOKEN">): TelegramApi | null {
  return env.TELEGRAM_BOT_TOKEN ? new TelegramApi(env.TELEGRAM_BOT_TOKEN) : null;
}

@Module({
  imports: [UsersModule],
  controllers: [AuthController, TelegramController],
  providers: [
    {
      provide: Sessions,
      inject: [PrismaService, ENV],
      useFactory: (db: PrismaService, env: Env) => new Sessions(db, env.SESSION_TTL_HOURS * 3_600_000),
    },
    {
      provide: Auth,
      inject: [PrismaService, Sessions],
      useFactory: (db: PrismaService, s: Sessions) => new Auth(db, s),
    },
    {
      provide: SignupBot,
      inject: [PrismaService, Players, ENV],
      useFactory: (db: PrismaService, players: Players, env: Env) =>
        new SignupBot(db, players, {
          brand: env.PLATFORM_NAME,
          webappUrl: env.WEBAPP_URL,
          publicWebUrl: env.PUBLIC_WEB_URL ?? `https://${env.PLATFORM_DOMAIN}`,
        }),
    },
    {
      provide: TELEGRAM_API,
      inject: [ENV],
      useFactory: telegramApiFor,
    },
    PrincipalMiddleware,
  ],
  exports: [Sessions],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PrincipalMiddleware).forRoutes("*");
  }
}
