import { Module } from "@nestjs/common";
import type { Env } from "../config/env";
import { PrismaService } from "../db/prisma.service";
import { ENV } from "../tokens";
import { Hierarchy } from "../users/hierarchy";
import { UsersModule } from "../users/users.module";
import { Admin } from "./admin";
import { AdminController, PublicController } from "./admin.controller";

@Module({
  imports: [UsersModule],
  controllers: [AdminController, PublicController],
  providers: [
    {
      provide: Admin,
      inject: [PrismaService, Hierarchy, ENV],
      useFactory: (db: PrismaService, hierarchy: Hierarchy, env: Env) =>
        new Admin(db, hierarchy, {
          botUsername: env.TELEGRAM_BOT_USERNAME,
          domain: env.PLATFORM_DOMAIN,
          webUrl: env.PUBLIC_WEB_URL,
        }),
    },
  ],
})
export class AdminModule {}
