import "server-only";
import { prisma } from "./prisma";

/** Whole-day index (UTC) — used to compare calendar days. */
export function dayIndexUtc(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/**
 * The streak to actually display. A streak is only "alive" if the last
 * qualifying play was today or yesterday; otherwise it has lapsed and reads 0
 * (lazy reset — the stored value is corrected on the next play).
 */
export function effectiveStreak(streakDays: number, lastPlayedAt: Date | null): number {
  if (!lastPlayedAt) return 0;
  const today = dayIndexUtc(new Date());
  const last = dayIndexUtc(lastPlayedAt);
  return last === today || last === today - 1 ? streakDays : 0;
}

/**
 * Points are dual-booked. `loyaltyPoints` is lifetime XP — it drives the tier
 * ladder, the points-target achievements and the all-time leaderboard, so it is
 * never decremented (an achievement, once earned, can never be lost).
 * `pointsBalance` is the spendable wallet and is the only counter a redemption
 * debits. Award through this helper so the two can't drift apart.
 */
export function awardPoints(n: number) {
  return n > 0
    ? { loyaltyPoints: { increment: n }, pointsBalance: { increment: n } }
    : {};
}

/** A user's lifetime loyalty points (0 when logged out / unknown). */
export async function getUserPoints(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { loyaltyPoints: true },
  });
  return u?.loyaltyPoints ?? 0;
}

/**
 * ISO-8601 week key like "2026-W24" (UTC). Stable identifier used for
 * once-per-week idempotency — weekly cashback claims and the
 * "first deposit of the week" bonus.
 */
export function isoWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Calendar-day key like "2026-08-10" (UTC) — the daily twin of isoWeekKey,
 *  used for once-per-day idempotency. Can never collide with a week key. */
export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 00:00:00 UTC of the day containing `date`. */
export function utcDayStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Monday 00:00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}
