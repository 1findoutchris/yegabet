import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

/*
 * One-time login handoffs: "this user just proved who they are elsewhere —
 * sign them in here". Used when a Telegram-verified registration completes,
 * both by the page that started it and by the bot's "Continue on Website"
 * button.
 *
 * A handoff is 32 random bytes, kept only in Redis, valid for minutes and
 * consumed atomically (GETDEL) by the "handoff" provider in lib/auth.ts, which
 * exchanges it for the normal session cookie. It carries no personal data;
 * the user id lives server-side under it.
 */

/** The page that started the signup collects it within a poll or two. */
export const BROWSER_HANDOFF_TTL = 2 * 60;
/** The bot button may be tapped a little later — still single-use. */
export const BOT_HANDOFF_TTL = 10 * 60;

const key = (token: string) => `auth:handoff:${token}`;
const SHAPE = /^[A-Za-z0-9_-]{43}$/;

export async function issueHandoff(userId: string, ttlSeconds: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await redis.set(key(token), userId, "EX", ttlSeconds);
  return token;
}

/**
 * Exchange a handoff for the account it was issued for — once. Null for a
 * malformed, unknown, expired or already-used token, and for an account that
 * may no longer sign in (banned, or an in-person agent, who sign in only
 * through their portal — see lib/auth.ts).
 */
export async function handoffSignIn(token: string) {
  if (!SHAPE.test(token)) return null;
  const userId = await redis.getdel(key(token));
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, name: true, phone: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive || user.role === "IN_PERSON_AGENT") return null;
  return user;
}
