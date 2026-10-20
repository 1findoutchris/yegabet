import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "../config/env";
import { Authenticated, Public } from "../auth/guard";
import type { Principal } from "../auth/rbac";
import { ENV } from "../tokens";
import { GameWallet } from "./gameWallet";
import { Games, GamesError } from "./games";
import { answer, error, parse, verifySignature, type OctheraAnswer } from "./octhera/adapter";

/**
 * Octhera's Wallet URL. Always HTTP 200 + JSON (anything else turns a bet into
 * a rollback on their side), except a crash, which answers 500 so they retry;
 * every call is safe to retry.
 */
@Controller("providers/octhera")
export class OctheraWalletController {
  private readonly log = new Logger("octhera-wallet");

  constructor(
    private readonly wallet: GameWallet,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post("wallet")
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-octhera-timestamp") timestamp: string | undefined,
    @Headers("x-octhera-signature") signature: string | undefined,
    @Body() body: unknown,
  ): Promise<OctheraAnswer> {
    const raw = req.rawBody?.toString("utf8") ?? "";
    if (!verifySignature(raw, timestamp ?? "", signature ?? "", this.env.OCTHERA_WALLET_SECRET)) {
      this.log.warn(
        this.env.OCTHERA_WALLET_SECRET
          ? "bad signature or old timestamp"
          : "OCTHERA_WALLET_SECRET is not set",
      );
      return error("INVALID_SIGNATURE");
    }
    const parsed = parse(body, this.env.OCTHERA_CURRENCY);
    if (parsed.kind === "ping") return { status: "ok" };
    if (parsed.kind === "invalid") {
      this.log.warn(`invalid request: ${parsed.why}`);
      return error("INVALID_REQUEST");
    }
    const result = await this.wallet.handle(parsed.call);
    const out = answer(result);
    const c = parsed.call;
    // One line per call: "is Octhera calling us, and what do we answer?" (no amounts of other players, no secrets)
    this.log.log(`${c.type}/${c.action ?? "-"} txn=${c.txnId} → ${out.code ?? "ok"}`);
    return out;
  }
}

function gamesHttp(e: unknown): never {
  if (!(e instanceof GamesError)) throw e;
  if (e.code === "NOT_FOUND") throw new NotFoundException(e.message);
  if (e.code === "PLAYER_NOT_ALLOWED") throw new ForbiddenException(e.message);
  throw new ServiceUnavailableException(e.message);
}

@Controller("games")
export class GamesController {
  constructor(private readonly games: Games) {}

  @Public()
  @Get()
  list(@Query() q: Record<string, unknown>) {
    return this.games.list(q);
  }

  @Authenticated()
  @Post(":uid/launch")
  @HttpCode(200)
  async launch(
    @Req() req: Request & { principal: Principal },
    @Param("uid") uid: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (req.principal.kind !== "player") throw new ForbiddenException("players only");
    try {
      return { url: await this.games.launch(req.principal.playerId, uid, body.device) };
    } catch (e) {
      gamesHttp(e);
    }
  }
}
