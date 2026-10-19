import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env";
import { Public } from "../auth/guard";
import { ENV } from "../tokens";
import { SignupBot, type BotCall, type TgUpdate } from "./bot";

/** Sends Bot API calls. Swappable in tests. */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(call: BotCall): Promise<void> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${call.method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram ${call.method} failed: HTTP ${res.status}`);
  }
}

export const TELEGRAM_API = Symbol("TELEGRAM_API");

function sameSecret(got: string | undefined, want: string): boolean {
  const a = Buffer.from(got ?? "");
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Telegram's webhook. Only Telegram knows the secret (set with setWebhook),
 * so a call without it is refused before anything is read.
 */
@Controller("telegram")
export class TelegramController {
  private readonly log = new Logger("telegram");

  constructor(
    private readonly bot: SignupBot,
    @Inject(TELEGRAM_API) private readonly api: TelegramApi | null,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: TgUpdate,
  ): Promise<{ ok: true }> {
    const want = this.env.TELEGRAM_WEBHOOK_SECRET;
    if (!want || !this.api) throw new ServiceUnavailableException("Telegram bot is not configured yet");
    if (!sameSecret(secret, want)) throw new UnauthorizedException();

    // An unexpected error here returns 500, and Telegram retries the update;
    // every step is safe to repeat.
    const calls = await this.bot.handle(update);
    for (const call of calls) {
      try {
        await this.api.call(call);
      } catch (e) {
        // The account work is done; a failed reply must not make Telegram retry it.
        this.log.warn(`reply failed: ${(e as Error).message}`);
      }
    }
    return { ok: true };
  }
}
