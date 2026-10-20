import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { audit } from "../auth/audit";
import { actorOf } from "../auth/auth.service";
import { Authenticated, Requires } from "../auth/guard";
import type { Principal } from "../auth/rbac";
import { addConfigVersion, configAt } from "../config/configVersions";
import { PrismaService } from "../db/prisma.service";
import { RulesError, VALIDATORS } from "./rules";
import { Settlement, SettlementError, periodView } from "./settlement";

type Req_ = Request & { principal: Principal };

/** Settlement errors to HTTP; anything else is rethrown unchanged (→ 500). */
export function settlementHttp(e: unknown): never {
  if (e instanceof RulesError) throw new BadRequestException(e.message);
  if (!(e instanceof SettlementError)) throw e;
  if (e.code === "NOT_FOUND") throw new NotFoundException(e.message);
  if (e.code === "RULES") throw new ServiceUnavailableException(e.message);
  throw new ConflictException(e.message);
}

function idParam(id: string): bigint {
  if (!/^\d{1,18}$/.test(id)) throw new NotFoundException("no such period");
  return BigInt(id);
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    settlementHttp(e);
  }
}

@Controller()
export class SettlementController {
  constructor(private readonly settlement: Settlement) {}

  @Requires("settlement.manage")
  @Get("admin/settlement/periods")
  async periods() {
    return run(async () => {
      await this.settlement.ensurePeriodsIfConfigured(); // before launch: just list
      return (await this.settlement.list()).map(periodView);
    });
  }

  @Requires("settlement.manage")
  @Post("admin/settlement/periods/:id/draft")
  @HttpCode(200)
  draft(@Req() req: Req_, @Param("id") id: string) {
    return run(async () => periodView(await this.settlement.draft(idParam(id), req.principal)));
  }

  @Requires("settlement.manage")
  @Get("admin/settlement/periods/:id/statements")
  statements(@Param("id") id: string) {
    return run(() => this.settlement.statements(idParam(id)));
  }

  @Requires("settlement.manage")
  @Post("admin/settlement/periods/:id/approve")
  @HttpCode(200)
  approve(@Req() req: Req_, @Param("id") id: string) {
    return run(async () => periodView(await this.settlement.approve(idParam(id), req.principal)));
  }

  @Authenticated()
  @Get("agent/statements")
  mine(@Req() req: Req_) {
    if (req.principal.kind !== "agent_member") throw new ForbiddenException("agents only");
    return run(() => this.settlement.agentStatements((req.principal as { agentId: bigint }).agentId));
  }
}

/**
 * The owner changes rules here (owner, 2026-10-20: "do not hardcode, I may
 * change some rules"). Each change is a new dated version; earlier versions,
 * and every approved period, stay exactly as they were.
 */
@Controller("admin/config")
export class ConfigController {
  constructor(private readonly db: PrismaService) {}

  @Requires("config.write")
  @Get()
  async current() {
    const now = new Date();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(VALIDATORS)) {
      const row = await configAt(this.db, key, now);
      out[key] = row ? { value: row.value, effectiveFrom: row.effectiveFrom.toISOString() } : null;
    }
    return out;
  }

  @Requires("config.write")
  @Post()
  @HttpCode(201)
  async set(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    const key = body.key;
    if (typeof key !== "string" || !VALIDATORS[key]) {
      throw new BadRequestException(`key must be one of: ${Object.keys(VALIDATORS).join(", ")}`);
    }
    try {
      VALIDATORS[key](body.value);
    } catch (e) {
      settlementHttp(e);
    }
    const effectiveFrom =
      body.effectiveFrom === undefined ? new Date() : new Date(String(body.effectiveFrom));
    if (Number.isNaN(effectiveFrom.getTime()))
      throw new BadRequestException("effectiveFrom must be an ISO date");
    const before = await configAt(this.db, key, effectiveFrom);
    const actor = actorOf(req.principal);
    try {
      const row = await addConfigVersion(this.db, {
        key,
        value: body.value as Prisma.InputJsonValue,
        effectiveFrom,
        createdBy: `${actor.actorKind}:${actor.actorId}`,
      });
      await audit(this.db, {
        ...actor,
        action: "config.changed",
        target: `config:${key}`,
        before: (before?.value ?? null) as Prisma.InputJsonValue,
        after: { value: body.value as Prisma.InputJsonValue, effectiveFrom: effectiveFrom.toISOString() },
        ip: req.ip,
      });
      return { key, value: row.value, effectiveFrom: row.effectiveFrom.toISOString() };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        throw new ConflictException("a version of this key already starts at that exact time");
      }
      throw e;
    }
  }
}
