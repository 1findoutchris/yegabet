import type { PrismaClient } from "@prisma/client";
import { audit } from "../auth/audit";
import { WEB_START_PREFIX } from "../auth/auth.service";
import { sha256 } from "../auth/sessions";
import { isEnabled } from "../config/featureFlags";
import { UsersError } from "../users/errors";
import type { Players } from "../users/players";

/**
 * The sign-up conversation (plan 04 §5):
 *   /start [agent_slug | w_<web code>] → "18 or older?" [Yes] → [Share my phone]
 *   → own contact → account created, attached to the referral agent.
 *
 * `handle` returns the Bot API calls to make instead of making them, so every
 * path is testable without Telegram. The webhook controller sends them.
 */

export const SIGNUP_FLAG = "signup.open";
export const INTENT_TTL_MS = 30 * 60 * 1000;

export interface BotCall {
  method: "sendMessage" | "answerCallbackQuery";
  body: Record<string, unknown>;
}

interface TgUser {
  id: number | string;
}
export interface TgUpdate {
  update_id?: number;
  message?: {
    from?: TgUser;
    chat: { id: number | string };
    text?: string;
    contact?: { phone_number: string; user_id?: number | string };
  };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number | string } } };
}

export interface BotConfig {
  /** Brand shown in messages (PLATFORM_NAME; never hardcoded, CLAUDE.md §2). */
  brand: string;
  /** Mini App address for the [Open …] button. */
  webappUrl?: string;
  /** Website, for [Continue on website] after a website sign-up. */
  publicWebUrl?: string;
}

const AGE_BUTTON = { inline_keyboard: [[{ text: "Yes, I'm 18 or older", callback_data: "age_yes" }]] };
const DIRECT_BUTTON = { inline_keyboard: [[{ text: "Sign up directly", callback_data: "direct" }]] };
const PHONE_KEYBOARD = {
  keyboard: [[{ text: "Share my phone", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export class SignupBot {
  constructor(
    private readonly db: PrismaClient,
    private readonly players: Players,
    private readonly config: BotConfig,
  ) {}

  async handle(update: TgUpdate): Promise<BotCall[]> {
    const cb = update.callback_query;
    if (cb) {
      const answer: BotCall = { method: "answerCallbackQuery", body: { callback_query_id: cb.id } };
      const chatId = cb.message?.chat.id ?? cb.from.id;
      return [answer, ...(await this.onButton(String(cb.from.id), chatId, cb.data))];
    }
    const msg = update.message;
    if (!msg?.from) return [];
    const userId = String(msg.from.id);
    if (msg.contact) return this.onContact(userId, msg.chat.id, msg.contact);
    const text = msg.text?.trim() ?? "";
    if (text === "/start" || text.startsWith("/start "))
      return this.onStart(userId, msg.chat.id, text.slice(6).trim());
    return [this.say(msg.chat.id, "Send /start to create your account.")];
  }

  // ── Steps ───────────────────────────────────────────────────────────────────

  private async onStart(userId: string, chatId: number | string, payload: string): Promise<BotCall[]> {
    if (!(await this.open())) return [this.soon(chatId)];
    if (await this.registered(userId)) return [this.already(chatId)];

    let referralSlug: string | null = null;
    let webCodeHash: string | null = null;
    if (payload.startsWith(WEB_START_PREFIX)) {
      const codeHash = sha256(payload.slice(WEB_START_PREFIX.length));
      const web = await this.db.webSignup.findUnique({ where: { codeHash } });
      if (!web || web.consumedAt || web.playerId !== null || web.expiresAt.getTime() <= Date.now()) {
        return [this.say(chatId, "This sign-up link has expired. Please start again on the website.")];
      }
      referralSlug = web.referralSlug;
      webCodeHash = codeHash;
    } else if (payload) {
      const agent = await this.db.agent.findUnique({ where: { slug: payload } });
      if (!agent || agent.status !== "active" || agent.isCompany) return [this.invalidLink(chatId)];
      referralSlug = agent.slug;
    }
    await this.saveIntent(userId, { referralSlug, webCodeHash, ageConfirmedAt: null });
    return [this.askAge(chatId)];
  }

  private async onButton(userId: string, chatId: number | string, data?: string): Promise<BotCall[]> {
    if (data !== "age_yes" && data !== "direct") return [];
    if (!(await this.open())) return [this.soon(chatId)];
    if (await this.registered(userId)) return [this.already(chatId)];
    if (data === "direct") {
      await this.saveIntent(userId, { referralSlug: null, webCodeHash: null, ageConfirmedAt: null });
      return [this.askAge(chatId)];
    }
    const intent = await this.intent(userId);
    await this.saveIntent(userId, {
      referralSlug: intent?.referralSlug ?? null,
      webCodeHash: intent?.webCodeHash ?? null,
      ageConfirmedAt: new Date(),
    });
    return [this.say(chatId, "Now share your phone number to create your account.", PHONE_KEYBOARD)];
  }

  private async onContact(
    userId: string,
    chatId: number | string,
    contact: { phone_number: string; user_id?: number | string },
  ): Promise<BotCall[]> {
    if (!(await this.open())) return [this.soon(chatId)];
    // Telegram vouches only for the user's *own* number (§5.5).
    if (contact.user_id === undefined || String(contact.user_id) !== userId) {
      return [this.say(chatId, "Please share your own number using the button below.", PHONE_KEYBOARD)];
    }
    const intent = await this.intent(userId);
    if (!intent?.ageConfirmedAt) {
      await this.saveIntent(userId, {
        referralSlug: intent?.referralSlug ?? null,
        webCodeHash: intent?.webCodeHash ?? null,
        ageConfirmedAt: null,
      });
      return [this.askAge(chatId)];
    }

    let playerId: bigint;
    try {
      const player = await this.players.register({
        phone: contact.phone_number,
        telegramUserId: userId,
        referralSlug: intent.referralSlug ?? undefined,
        ageConfirmedAt: intent.ageConfirmedAt,
      });
      playerId = player.id;
      await audit(this.db, {
        actorKind: "player",
        actorId: player.id.toString(),
        action: "player.registered",
        after: { agentId: player.agentId.toString(), via: intent.webCodeHash ? "website" : "telegram" },
      });
    } catch (e) {
      if (!(e instanceof UsersError)) throw e;
      if (e.code === "PHONE_TAKEN" || e.code === "TELEGRAM_TAKEN") return [this.already(chatId)];
      if (e.code === "INVALID_REFERRAL") return [this.invalidLink(chatId)];
      return [this.say(chatId, "Only Ethiopian mobile numbers can sign up for now.")];
    }

    if (intent.webCodeHash) {
      await this.db.webSignup.updateMany({
        where: { codeHash: intent.webCodeHash, playerId: null },
        data: { playerId },
      });
    }
    await this.db.signupIntent.delete({ where: { telegramUserId: userId } });

    const calls = [
      this.say(chatId, `✅ Your ${this.config.brand} account is ready.`, { remove_keyboard: true }),
    ];
    const buttons = [];
    if (intent.webCodeHash && this.config.publicWebUrl) {
      buttons.push([{ text: "Continue on website", url: this.config.publicWebUrl }]);
    }
    if (this.config.webappUrl)
      buttons.push([{ text: `Open ${this.config.brand}`, web_app: { url: this.config.webappUrl } }]);
    if (buttons.length > 0)
      calls.push(this.say(chatId, "Where would you like to play?", { inline_keyboard: buttons }));
    return calls;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private open(): Promise<boolean> {
    return isEnabled(this.db, SIGNUP_FLAG);
  }

  private async registered(userId: string): Promise<boolean> {
    return (
      (await this.db.player.findUnique({ where: { telegramUserId: userId }, select: { id: true } })) !== null
    );
  }

  private async intent(userId: string) {
    const row = await this.db.signupIntent.findUnique({ where: { telegramUserId: userId } });
    return row && row.expiresAt.getTime() > Date.now() ? row : null;
  }

  private async saveIntent(
    userId: string,
    data: { referralSlug: string | null; webCodeHash: string | null; ageConfirmedAt: Date | null },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);
    await this.db.signupIntent.upsert({
      where: { telegramUserId: userId },
      create: { telegramUserId: userId, ...data, expiresAt },
      update: { ...data, expiresAt },
    });
  }

  private say(chatId: number | string, text: string, replyMarkup?: object): BotCall {
    return {
      method: "sendMessage",
      body: replyMarkup ? { chat_id: chatId, text, reply_markup: replyMarkup } : { chat_id: chatId, text },
    };
  }

  private askAge(chatId: number | string): BotCall {
    return this.say(
      chatId,
      `Welcome to ${this.config.brand}!\n\nYou must be 18 or older to create an account. Are you 18 or older?`,
      AGE_BUTTON,
    );
  }

  private soon(chatId: number | string): BotCall {
    return this.say(chatId, `Sign-ups for ${this.config.brand} open soon. Please check back later.`);
  }

  private already(chatId: number | string): BotCall {
    const markup = this.config.webappUrl
      ? {
          inline_keyboard: [[{ text: `Open ${this.config.brand}`, web_app: { url: this.config.webappUrl } }]],
        }
      : undefined;
    return this.say(chatId, "You already have an account.", markup);
  }

  private invalidLink(chatId: number | string): BotCall {
    return this.say(
      chatId,
      "This referral link is not valid. You can still sign up directly.",
      DIRECT_BUTTON,
    );
  }
}
