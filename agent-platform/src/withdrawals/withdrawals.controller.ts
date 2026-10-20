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
import { WithdrawalError, Withdrawals } from "./withdrawals";

type Req_ = Request & { principal: Principal };

/** Withdrawal errors to HTTP; anything else is rethrown unchanged (→ 500). */
export function withdrawalHttp(e: unknown): never {
  if (!(e instanceof WithdrawalError)) throw e;
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
    case "WRONG_STATE":
    case "INSUFFICIENT_FUNDS":
      throw new ConflictException(e.message);
    default:
      throw new BadRequestException(e.message);
  }
}

function idParam(id: string): bigint {
  if (!/^\d{1,18}$/.test(id)) throw new NotFoundException("no such withdrawal");
  return BigInt(id);
}

const out = (w: { id: bigint; status: string; amount: bigint }) => ({
  id: w.id.toString(),
  status: w.status,
  amountSantim: w.amount.toString(),
});

/** Who may act is checked inside Withdrawals (role + row scope + state); the guard only requires a login. */
@Authenticated()
@Controller()
export class WithdrawalsController {
  /** 10 withdrawal requests per minute per player (§7). */
  private readonly requestLimiter = new RateLimiter(10, 60_000);

  constructor(private readonly withdrawals: Withdrawals) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      withdrawalHttp(e);
    }
  }

  // Player

  @Post("withdrawals")
  @HttpCode(201)
  request(@Req() req: Req_, @Body() body: Record<string, unknown>) {
    if (req.principal.kind !== "player") throw new ForbiddenException("players only");
    const playerId = req.principal.playerId;
    this.requestLimiter.hit(`withdrawal:${playerId}`);
    return this.run(async () => out(await this.withdrawals.request(playerId, body, req.ip)));
  }

  @Get("withdrawals")
  mine(@Req() req: Req_) {
    if (req.principal.kind !== "player") throw new ForbiddenException("players only");
    return this.run(() => this.withdrawals.listForPlayer((req.principal as { playerId: bigint }).playerId));
  }

  @Post("withdrawals/:id/cancel")
  @HttpCode(200)
  cancel(@Req() req: Req_, @Param("id") id: string) {
    return this.run(async () => out(await this.withdrawals.cancel(req.principal, idParam(id), req.ip)));
  }

  @Post("withdrawals/:id/received")
  @HttpCode(200)
  received(@Req() req: Req_, @Param("id") id: string) {
    return this.run(async () => out(await this.withdrawals.received(req.principal, idParam(id), req.ip)));
  }

  @Post("withdrawals/:id/not-received")
  @HttpCode(200)
  notReceived(@Req() req: Req_, @Param("id") id: string) {
    return this.run(async () => out(await this.withdrawals.notReceived(req.principal, idParam(id), req.ip)));
  }

  // Agent members (own agent) and the owner

  @Get("agent/withdrawals")
  queue(@Req() req: Req_, @Query("status") status: unknown) {
    return this.run(() => this.withdrawals.queue(req.principal, status));
  }

  @Post("agent/withdrawals/:id/paid")
  @HttpCode(200)
  paid(@Req() req: Req_, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.run(async () =>
      out(await this.withdrawals.markPaid(req.principal, idParam(id), body.reference, req.ip)),
    );
  }

  @Post("agent/withdrawals/:id/decline")
  @HttpCode(200)
  decline(@Req() req: Req_, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.run(async () =>
      out(await this.withdrawals.decline(req.principal, idParam(id), body.reason, req.ip)),
    );
  }

  @Post("agent/withdrawals/:id/complete")
  @HttpCode(200)
  complete(@Req() req: Req_, @Param("id") id: string) {
    return this.run(async () => out(await this.withdrawals.complete(req.principal, idParam(id), req.ip)));
  }

  @Post("agent/withdrawals/:id/cancel")
  @HttpCode(200)
  staffCancel(@Req() req: Req_, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.run(async () =>
      out(await this.withdrawals.staffCancel(req.principal, idParam(id), body.reason, req.ip)),
    );
  }
}
