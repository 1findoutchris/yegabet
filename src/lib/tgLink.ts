import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import type { TgContact } from "@/lib/tgVerifyCore";
import { validateInitData } from "@/lib/tgInitDataCore";
import { linkDecision, phoneVariants, provenPhone, type LinkRejection } from "@/lib/tgLinkCore";

/*
 * Telegram ↔ YegaBet account linking.
 *
 * The only way in is the bot receiving the user's own contact card (see
 * tgLinkCore.provenPhone). Linking writes the five telegram* columns and
 * nothing else — wallet, bets, password and every other field are untouched,
 * and no account is ever created here.
 */

export type TgSender = { id: number; username?: string; first_name?: string };

export type LinkResult =
  | { ok: true; userId: string; accountNo: number; name: string | null; phone: string; relinked: boolean }
  | { ok: false; reason: LinkRejection; phone?: string };

const LINK_SELECT = { id: true, isActive: true, role: true, telegramUserId: true } as const;

export async function linkByContact(contact: TgContact, from: TgSender): Promise<LinkResult> {
  const proof = provenPhone(contact, from.id);
  if (!proof.ok) return { ok: false, reason: proof.reason };

  const telegramUserId = String(from.id);
  const [candidates, holder] = await Promise.all([
    prisma.user.findMany({ where: { phone: { in: phoneVariants(proof.phone) } }, select: LINK_SELECT, take: 2 }),
    prisma.user.findUnique({ where: { telegramUserId }, select: { id: true } }),
  ]);

  const decision = linkDecision(telegramUserId, candidates, holder?.id ?? null);
  if (decision.do === "reject") return { ok: false, reason: decision.reason, phone: proof.phone };

  const now = new Date();
  try {
    // updateMany with the guard in the WHERE: if the account was linked to a
    // different Telegram between the read above and this write, 0 rows change
    // instead of overwriting it.
    const { count } = await prisma.user.updateMany({
      where: {
        id: decision.userId,
        OR: [{ telegramUserId: null }, { telegramUserId }],
      },
      data: {
        telegramUserId,
        telegramUsername: from.username ?? null,
        telegramFirstName: from.first_name ?? null,
        telegramPhoneVerifiedAt: now,
        ...(decision.do === "link" ? { telegramLinkedAt: now } : {}),
      },
    });
    if (count === 0) return { ok: false, reason: "account-has-other-telegram", phone: proof.phone };
  } catch (e) {
    // The unique index on telegramUserId: two simultaneous links of the same
    // Telegram to different accounts. The loser is told it's already in use.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, reason: "telegram-in-use", phone: proof.phone };
    }
    throw e;
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: decision.userId },
    select: { id: true, accountNo: true, name: true, phone: true },
  });
  return { ok: true, userId: user.id, accountNo: user.accountNo, name: user.name, phone: user.phone, relinked: decision.do === "refresh" };
}

/** The YegaBet account this Telegram user is linked to, if it may sign in. */
export async function linkedUser(telegramUserId: number) {
  const user = await prisma.user.findUnique({
    where: { telegramUserId: String(telegramUserId) },
    select: {
      id: true, username: true, name: true, phone: true, email: true, role: true, isActive: true,
      accountNo: true, balance: true, loyaltyTier: true, loyaltyPoints: true,
    },
  });
  if (!user || !user.isActive || user.role === "IN_PERSON_AGENT") return null;
  return user;
}

/**
 * The Mini App sign-in: raw initData in, the linked YegaBet user out — or
 * null for a bad signature, a stale launch, an unlinked Telegram, or an
 * account that may not sign in. This is the `authorize` of the "telegram"
 * provider in lib/auth.ts.
 */
export async function telegramSignIn(initData: string, botToken: string | undefined) {
  if (!botToken) return null;
  const result = validateInitData(initData, botToken);
  if (!result.ok) return null;
  return linkedUser(result.user.id);
}

/** Remove the link held by this Telegram user. Returns whether one existed. */
export async function unlinkTelegram(telegramUserId: number): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: { telegramUserId: String(telegramUserId) },
    data: TELEGRAM_CLEARED,
  });
  return count > 0;
}

/** Every telegram* column back to empty — shared with the admin unlink. */
export const TELEGRAM_CLEARED = {
  telegramUserId: null,
  telegramUsername: null,
  telegramFirstName: null,
  telegramLinkedAt: null,
  telegramPhoneVerifiedAt: null,
} as const;

// ── last outcome, for the Mini App ─────────────────────────────────────────
// The Mini App asks Telegram to share the contact, and the contact then
// arrives here through the webhook — so the app has no direct answer. The
// webhook leaves the outcome for a couple of minutes; the app's poll reads it.

const outcomeKey = (telegramUserId: number) => `tglink:last:${telegramUserId}`;
const OUTCOME_TTL = 2 * 60;

export async function rememberOutcome(telegramUserId: number, reason: LinkRejection): Promise<void> {
  await redis.set(outcomeKey(telegramUserId), `${Date.now()}:${reason}`, "EX", OUTCOME_TTL);
}

/** The latest failed link attempt at or after `since` (ms), if any. */
export async function recentOutcome(telegramUserId: number, since: number): Promise<LinkRejection | null> {
  const raw = await redis.get(outcomeKey(telegramUserId));
  if (!raw) return null;
  const sep = raw.indexOf(":");
  const at = Number(raw.slice(0, sep));
  return at >= since ? (raw.slice(sep + 1) as LinkRejection) : null;
}
