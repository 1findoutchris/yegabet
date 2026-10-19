import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../db/prisma.service";
import { ENV } from "../tokens";
import type { Env } from "../config/env";

const DB_TIMEOUT_MS = 2_000;

@Controller("health")
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async health(@Res() res: Response): Promise<void> {
    const dbOk = await Promise.race([
      this.db.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DB_TIMEOUT_MS)),
    ]);
    res.status(dbOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: dbOk ? "ok" : "degraded",
      db: dbOk ? "ok" : "down",
      version: this.env.APP_VERSION,
      time: new Date().toISOString(),
    });
  }
}
