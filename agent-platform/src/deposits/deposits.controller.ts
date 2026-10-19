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
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { Authenticated } from "../auth/guard";
import { RateLimiter } from "../auth/rateLimit";
import type { Principal } from "../auth/rbac";
import { DepositError, Deposits } from "./deposits";

type Req_ = Request & { principal: Principal };

/** Deposit errors to HTTP; anything else is rethrown unchanged (→ 500). */
export function depositHttp(e: unknown): never {
  if (!(e instanceof DepositError)) throw e;
  switch (e.code) {
    case "CLOSED":
    case "NOT_CONFIGURED":
      throw new ServiceUnavailableException(e.message);
    case "FORBIDDEN":
    case "PLAYER_NOT_ALLOWED":
    case "AGENT_NOT_ACTIVE":
      throw new ForbiddenException(e.message);
    case "NOT_FOUND":
      throw new NotFoundException(e.message);
    case "DUPLICATE_REFERENCE":
    case "ALREADY_DECIDED":
    case "ACCOUNT_TAKEN":
      throw new ConflictException(e.message);
    default:
      throw new BadRequestException(e.message);
  }
}

function playerId(req: Req_): bigint {
  if (req.principal.kind !== "player") throw new ForbiddenException("players only");
  return req.principal.playerId;
}

function idParam(id: string): bigint {
  if (!/^\d{1,18}$/.test(id)) throw new NotFoundException("no such item");
  return BigInt(id);
}

/** Who may do what is checked inside Deposits (row scope + permission); the guard only requires a login. */
@Authenticated()
@Controller()
export class DepositsController {
  /** 10 deposit submissions per minute per player (§7 rate-limit deposits). */
  private readonly submitLimiter = new RateLimiter(10, 60_000);

  constructor(private readonly deposits: Deposits) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      depositHttp(e);
    }
  }

  // Player

  @Get("deposits/accounts")
  accounts(@Req() req: Req_) {
    return this.run(async () =>
      (await this.deposits.accountsForPlayer(playerId(req))).map((a) => ({ ...a, id: a.id.toString() })),
    );
  }

  @Post("deposits")
  @HttpCode(201)
  submit(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    const id = playerId(req);
    this.submitLimiter.hit(`deposit:${id}`);
    return this.run(async () => {
      const d = await this.deposits.submit(id, body, req.ip);
      return { id: d.id.toString(), status: d.status, amountSantim: d.amount.toString() };
    });
  }

  @Get("deposits")
  mine(@Req() req: Req_) {
    return this.run(() => this.deposits.listForPlayer(playerId(req)));
  }

  // Agent members (own agent) and staff who may override

  @Get("agent/payment-accounts")
  ownAccounts(@Req() req: Req_) {
    return this.run(async () =>
      (await this.deposits.listOwnPaymentAccounts(req.principal)).map((a) => ({
        ...a,
        id: a.id.toString(),
        agentId: a.agentId.toString(),
      })),
    );
  }

  @Post("agent/payment-accounts")
  @HttpCode(201)
  addAccount(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    return this.run(async () => {
      const a = await this.deposits.addPaymentAccount(req.principal, body, req.ip);
      return { ...a, id: a.id.toString(), agentId: a.agentId.toString() };
    });
  }

  @Post("agent/payment-accounts/:id/deactivate")
  @HttpCode(200)
  deactivate(@Req() req: Req_, @Param("id") id: string) {
    return this.run(async () => {
      await this.deposits.deactivatePaymentAccount(req.principal, idParam(id), req.ip);
      return { ok: true };
    });
  }

  @Get("agent/deposits")
  queue(@Req() req: Req_, @Query("status") status: unknown) {
    return this.run(() => this.deposits.queue(req.principal, status));
  }

  @Post("agent/deposits/:id/confirm")
  @HttpCode(200)
  confirm(@Req() req: Req_, @Param("id") id: string) {
    return this.decide(req, id, "confirm", undefined);
  }

  @Post("agent/deposits/:id/reject")
  @HttpCode(200)
  reject(@Req() req: Req_, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.decide(req, id, "reject", body.reason);
  }

  private decide(req: Req_, id: string, decision: "confirm" | "reject", reason: unknown) {
    return this.run(async () => {
      const d = await this.deposits.decide(req.principal, idParam(id), decision, reason, req.ip);
      return { id: d.id.toString(), status: d.status };
    });
  }
}
