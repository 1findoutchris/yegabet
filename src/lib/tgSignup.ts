import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { createUserAccount, type TelegramIdentity } from "@/lib/registration";
import { phoneVariants } from "@/lib/tgLinkCore";
import { signupContactVerdict, type SignupFailure } from "@/lib/tgSignupCore";
import type { TgContact } from "@/lib/tgVerifyCore";
import { verifyDeepLink } from "@/lib/tgVerifyCore";

/*
 * Telegram-verified registration.
 *
 *   form ─▶ POST /api/auth/register ─▶ createPending()      (no account yet)
 *        ◀─ t.me/<bot>?start=<token>  + httpOnly browser cookie
 *   bot  ─▶ /start <token> ─▶ bindChat() ─▶ "Share my phone number"
 *        ─▶ contact ─▶ completeSignup()  ─▶ account created + Telegram linked
 *   page ─▶ POST /api/auth/register/status (token + cookie) ─▶ handoff ─▶ session
 *
 * The pending request lives only in Redis and expires on its own. It holds
 * the form fields with the password already bcrypt-hashed — never the
 * password itself. The token in the link is random and says nothing about
 * the person; the phone number never leaves the server.
 */

/** How long a started registration stays open (form → bot → contact). */
export const PENDING_TTL = 15 * 60;
/** A finished one is kept briefly so the page's poll and a repeated tap get
 *  a consistent answer instead of "expired". */
const DONE_TTL = 15 * 60;

/** Cookie tying a pending registration to the browser that filled the form.
 *  httpOnly and path-scoped to /api/auth/register (the submit and status
 *  endpoints) — page scripts never see it. */
export const SIGNUP_COOKIE = "vb_signup";
export const SIGNUP_COOKIE_PATH = "/api/auth/register";

const TOKEN_BYTES = 16; // 32 hex chars — fits /start, unguessable

export type PendingSignup = {
  name: string;
  phone: string; // E.164
  passwordHash: string;
  referralCode?: string;
  promoCode?: string;
  /** sha256 of the browser cookie: only the browser that filled the form
   *  gets signed in automatically. */
  browser: string;
  createdAt: number;
  state: "waiting" | "failed" | "done";
  reason?: SignupFailure;
  /** Last digits of the Telegram number on a mismatch — never the whole number. */
  sharedEnding?: string;
  userId?: string;
  /** The page has already been handed its one login. */
  handedOff?: boolean;
};

const tokKey = (t: string) => `su:tok:${t}`;
const chatKey = (chatId: number) => `su:chat:${chatId}`;
const browserKey = (hash: string) => `su:br:${hash}`;
const lockKey = (t: string) => `su:lock:${t}`;

export const SIGNUP_TOKEN = /^[0-9a-f]{32}$/;

export function hashBrowser(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function newBrowserSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function browserMatches(pending: PendingSignup, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(hashBrowser(secret), "hex");
  const b = Buffer.from(pending.browser, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function save(token: string, p: PendingSignup, ttl?: number): Promise<void> {
  // Keep the remaining lifetime unless told otherwise — touching a pending
  // request must not extend it.
  const left = ttl ?? Math.max(await redis.ttl(tokKey(token)), 1);
  await redis.set(tokKey(token), JSON.stringify(p), "EX", left);
}

export async function getPending(token: string): Promise<PendingSignup | null> {
  if (!SIGNUP_TOKEN.test(token)) return null;
  const raw = await redis.get(tokKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

/**
 * Store a registration request and return its token and bot link. A browser
 * that resubmits (e.g. after correcting its number) replaces its previous
 * request, so an old link can't complete a stale form.
 */
export async function createPending(
  fields: Omit<PendingSignup, "browser" | "createdAt" | "state">,
  browserSecret: string,
  previousBrowserSecret?: string,
): Promise<{ token: string; url: string; expiresIn: number }> {
  if (previousBrowserSecret) {
    const prevHash = hashBrowser(previousBrowserSecret);
    const old = await redis.getdel(browserKey(prevHash));
    if (old) {
      const p = await getPending(old);
      if (p && p.state !== "done") await redis.del(tokKey(old));
    }
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const browser = hashBrowser(browserSecret);
  await save(token, { ...fields, browser, createdAt: Date.now(), state: "waiting" }, PENDING_TTL);
  await redis.set(browserKey(browser), token, "EX", PENDING_TTL);
  return { token, url: verifyDeepLink(token), expiresIn: PENDING_TTL };
}

/** Remember which registration this chat is answering — the contact message
 *  that follows carries no token of its own. */
export async function bindSignupChat(chatId: number, token: string): Promise<void> {
  await redis.set(chatKey(chatId), token, "EX", PENDING_TTL);
}

export async function signupTokenForChat(chatId: number): Promise<string | null> {
  return redis.get(chatKey(chatId));
}

export async function unbindSignupChat(chatId: number): Promise<void> {
  await redis.del(chatKey(chatId));
}

export type CompleteResult =
  | { kind: "created"; userId: string; accountNo: number }
  | { kind: "already"; userId: string; accountNo: number; sameTelegram: boolean }
  | { kind: "failed"; reason: SignupFailure; pending: PendingSignup }
  | { kind: "expired" }
  | { kind: "busy" };

/**
 * The contact arrived: verify it and, only if it proves the form's number,
 * create the account with the Telegram account linked.
 *
 * Safe to call repeatedly: a finished request answers "already" and never
 * creates a second account; a concurrent duplicate loses the lock; and the
 * phone / telegramUserId unique indexes stop anything that slips past both.
 */
export async function completeSignup(token: string, contact: TgContact, from: TelegramIdentity): Promise<CompleteResult> {
  const pending = await getPending(token);
  if (!pending) return { kind: "expired" };

  if (pending.state === "done" && pending.userId) {
    const u = await prisma.user.findUnique({ where: { id: pending.userId }, select: { accountNo: true, telegramUserId: true } });
    if (u) return { kind: "already", userId: pending.userId, accountNo: u.accountNo, sameTelegram: u.telegramUserId === String(from.id) };
  }

  const fail = async (reason: SignupFailure, sharedEnding?: string): Promise<CompleteResult> => {
    const next: PendingSignup = { ...pending, state: "failed", reason, sharedEnding };
    await save(token, next);
    return { kind: "failed", reason, pending: next };
  };

  const verdict = signupContactVerdict(contact, from.id, pending.phone);
  if (!verdict.ok) return fail(verdict.reason, verdict.shared?.replace(/\D/g, "").slice(-3));

  if ((await redis.set(lockKey(token), "1", "EX", 30, "NX")) === null) return { kind: "busy" };
  try {
    // One Telegram account = one VinnaBet account.
    const holder = await prisma.user.findUnique({ where: { telegramUserId: String(from.id) }, select: { id: true } });
    if (holder) return fail("telegram-in-use");

    const taken = await prisma.user.findFirst({ where: { phone: { in: phoneVariants(pending.phone) } }, select: { id: true } });
    if (taken) return fail("phone-taken");

    let user: { id: string };
    try {
      user = await createUserAccount({
        name: pending.name,
        phone: pending.phone,
        passwordHash: pending.passwordHash,
        referralCode: pending.referralCode,
        promoCode: pending.promoCode,
        ethiopian: true,
        otpVerified: true, // Telegram vouched for the number
        telegram: from,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
        return fail(target.includes("telegram") ? "telegram-in-use" : "phone-taken");
      }
      throw e;
    }

    await save(token, { ...pending, state: "done", userId: user.id, reason: undefined, sharedEnding: undefined }, DONE_TTL);
    const { accountNo } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { accountNo: true } });
    return { kind: "created", userId: user.id, accountNo };
  } finally {
    await redis.del(lockKey(token));
  }
}

/**
 * The page's one automatic login. Only the browser holding the cookie set
 * when the form was submitted gets it, and only once; anyone else holding
 * the token learns nothing beyond "verified".
 */
export async function claimBrowserLogin(token: string, browserSecret: string | undefined): Promise<
  { ok: true; userId: string } | { ok: false }
> {
  const pending = await getPending(token);
  if (!pending || pending.state !== "done" || !pending.userId || pending.handedOff) return { ok: false };
  if (!browserMatches(pending, browserSecret)) return { ok: false };
  // Atomic: two overlapping polls can't both win.
  if ((await redis.set(`su:claimed:${token}`, "1", "EX", DONE_TTL, "NX")) === null) return { ok: false };
  await save(token, { ...pending, handedOff: true });
  return { ok: true, userId: pending.userId };
}
