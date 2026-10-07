import { describe, expect, test } from "vitest";
import { lastDigits, signupContactVerdict, telegramSignupEnabled } from "@/lib/tgSignupCore";
import { continueOnWebsiteUrl } from "@/lib/tgBot";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("telegramSignupEnabled", () => {
  test("on when the bot is fully configured", () =>
    expect(telegramSignupEnabled(env({ TELEGRAM_VERIFY_BOT_TOKEN: "t", TELEGRAM_VERIFY_BOT_USERNAME: "b" }))).toBe(true));
  test("off without a username (dead link)", () =>
    expect(telegramSignupEnabled(env({ TELEGRAM_VERIFY_BOT_TOKEN: "t" }))).toBe(false));
  test("rollback switch, exact string only", () => {
    const base = { TELEGRAM_VERIFY_BOT_TOKEN: "t", TELEGRAM_VERIFY_BOT_USERNAME: "b" };
    expect(telegramSignupEnabled(env({ ...base, TELEGRAM_SIGNUP_DISABLED: "true" }))).toBe(false);
    expect(telegramSignupEnabled(env({ ...base, TELEGRAM_SIGNUP_DISABLED: "yes" }))).toBe(true);
  });
});

describe("signupContactVerdict", () => {
  const PHONE = "+251912345678";
  test("own card, same number", () =>
    expect(signupContactVerdict({ user_id: 5, phone_number: "251912345678" }, 5, PHONE)).toEqual({ ok: true, phone: PHONE }));
  test("someone else's card", () =>
    expect(signupContactVerdict({ user_id: 6, phone_number: "251912345678" }, 5, PHONE)).toEqual({ ok: false, reason: "not-own-contact" }));
  test("own card, different number", () =>
    expect(signupContactVerdict({ user_id: 5, phone_number: "251987654321" }, 5, PHONE)).toEqual({
      ok: false, reason: "mismatch", shared: "+251987654321",
    }));
  test("foreign number", () =>
    expect(signupContactVerdict({ user_id: 5, phone_number: "+15551234567" }, 5, PHONE)).toEqual({ ok: false, reason: "not-ethiopian" }));
  test("lastDigits", () => expect(lastDigits(PHONE)).toBe("678"));
});

describe("continueOnWebsiteUrl", () => {
  test("https only", () => {
    expect(continueOnWebsiteUrl("abc", env({ NEXT_PUBLIC_APP_URL: "https://vinna.bet/" }))).toBe("https://vinna.bet/auth/continue?t=abc");
    expect(continueOnWebsiteUrl("abc", env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }))).toBe("");
  });
});
