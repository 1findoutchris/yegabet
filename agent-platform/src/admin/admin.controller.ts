import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "../config/env";
import { Authenticated, Public, Requires } from "../auth/guard";
import type { Principal } from "../auth/rbac";
import { PrismaService } from "../db/prisma.service";
import { ENV } from "../tokens";
import { Admin, AdminError } from "./admin";

type Req_ = Request & { principal: Principal };

/** Admin errors to HTTP; anything else is rethrown unchanged (→ 500). */
export function adminHttp(e: unknown): never {
  if (!(e instanceof AdminError)) throw e;
  if (e.code === "NOT_FOUND") throw new NotFoundException(e.message);
  if (e.code === "CONFLICT") throw new ConflictException(e.message);
  if (e.code === "REFUSED") throw new ForbiddenException(e.message);
  throw new BadRequestException(e.message);
}

function id(v: string): bigint {
  if (!/^\d{1,18}$/.test(v)) throw new NotFoundException("not found");
  return BigInt(v);
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    adminHttp(e);
  }
}

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: Admin) {}

  @Requires("agents.read.all")
  @Get("agents")
  agents(@Query() q: Record<string, unknown>) {
    return this.admin.listAgents(q);
  }

  @Requires("agents.create")
  @Post("agents")
  @HttpCode(201)
  createAgent(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.createAgent(req.principal, body, req.ip));
  }

  @Requires("agents.create")
  @Post("agents/:id/status")
  @HttpCode(200)
  agentStatus(@Req() req: Req_, @Param("id") agentId: string, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.setAgentStatus(req.principal, id(agentId), body.status, req.ip));
  }

  @Requires("agents.read.all")
  @Get("agents/:id/members")
  members(@Param("id") agentId: string) {
    return this.admin.listMembers(id(agentId));
  }

  @Requires("agents.create")
  @Post("agents/:id/members")
  @HttpCode(201)
  addMember(@Req() req: Req_, @Param("id") agentId: string, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.addMember(req.principal, id(agentId), body, req.ip));
  }

  @Requires("agents.create")
  @Post("members/:id/status")
  @HttpCode(200)
  memberStatus(@Req() req: Req_, @Param("id") memberId: string, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.setMemberStatus(req.principal, id(memberId), body.status, req.ip));
  }

  @Requires("config.write")
  @Get("staff")
  staff() {
    return this.admin.listStaff();
  }

  @Requires("config.write")
  @Post("staff")
  @HttpCode(201)
  addStaff(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.addStaff(req.principal, body, req.ip));
  }

  @Requires("config.write")
  @Post("staff/:id/status")
  @HttpCode(200)
  staffStatus(@Req() req: Req_, @Param("id") staffId: string, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.setStaffStatus(req.principal, id(staffId), body.status, req.ip));
  }

  @Requires("config.write")
  @Get("flags")
  flags() {
    return this.admin.flags();
  }

  @Requires("config.write")
  @Post("flags")
  @HttpCode(200)
  setFlag(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    return run(() => this.admin.setFlag(req.principal, body.key, body.enabled, req.ip));
  }
}

/** Small reads the screens need. */
@Controller()
export class PublicController {
  constructor(
    private readonly db: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get("public/info")
  info() {
    return {
      name: this.env.PLATFORM_NAME,
      domain: this.env.PLATFORM_DOMAIN,
      botUsername: this.env.TELEGRAM_BOT_USERNAME ?? null,
      webappUrl: this.env.WEBAPP_URL ?? null,
    };
  }

  /**
   * An agent's public name for its referral link (`/?ref=<slug>`), so the site
   * can show "YegaBet <agent>". Only active agents; never the company agent.
   */
  @Public()
  @Get("public/agents/:slug")
  async agent(@Param("slug") slug: string) {
    const a = await this.db.agent.findUnique({
      where: { slug },
      select: { slug: true, displayName: true, status: true, isCompany: true },
    });
    if (!a || a.status !== "active" || a.isCompany) throw new NotFoundException("no such agent");
    return { slug: a.slug, displayName: a.displayName };
  }

  /** The logged-in player's agent (shown next to the brand; the company agent means a direct player). */
  @Authenticated()
  @Get("me/agent")
  async myAgent(@Req() req: Req_) {
    if (req.principal.kind !== "player") throw new ForbiddenException("players only");
    const p = await this.db.player.findUniqueOrThrow({
      where: { id: req.principal.playerId },
      select: { agent: { select: { slug: true, displayName: true, isCompany: true } } },
    });
    return p.agent;
  }

  /** The player's money: available (wallet) and held for withdrawals. */
  @Authenticated()
  @Get("me/wallet")
  async wallet(@Req() req: Req_) {
    if (req.principal.kind !== "player") throw new ForbiddenException("players only");
    const owner = { ownerKind: "player", ownerId: req.principal.playerId.toString() };
    const rows = await this.db.account.findMany({
      where: { ...owner, type: { in: ["PLAYER_WALLET", "PLAYER_HELD"] } },
      select: { type: true, balance: { select: { balance: true } } },
    });
    // Both accounts exist for every player (opened at sign-up, Task 03).
    const of = (type: string) =>
      (rows.find((r) => r.type === type) as { balance: { balance: bigint } }).balance.balance.toString();
    return { availableSantim: of("PLAYER_WALLET"), heldSantim: of("PLAYER_HELD") };
  }
}
