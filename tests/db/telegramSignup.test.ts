import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { signInitData } from "@/lib/tgInitDataCore";
import { truncateAll, makeUser } from "../factories";
import { json, req } from "../helpers/req";

/*
 * Telegram-verified registration, end to end through the real routes and
 * database: the form only stores a request, the bot creates the account after
 * the user's own contact matches, and the page / bot hand off a one-time login.
 */

const sent: { method: string; body: Record<string, unknown> }[] = [];
vi.mock("@/lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram")>();
  return {
    ...actual,
    tgCall: async (_t: string | undefined, method: string, body: Record<string, unknown>) => {
      sent.push({ method, body });
    },
  };
});

const BOT_TOKEN = "123456:TEST-signup-bot";
const SECRET = "test-signup-secret";
const ENV: Record<string, string> = {
  TELEGRAM_VERIFY_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_VERIFY_BOT_USERNAME: "VinnaTestBot",
  TELEGRAM_VERIFY_WEBHOOK_SECRET: SECRET,
  NEXT_PUBLIC_APP_URL: "https://vinna.test",
  OTP_DISABLED: "true", // must NOT skip verification on this flow
};
const saved: Record<string, string | undefined> = {};

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: status } = await import("@/app/api/auth/register/status/route");
const { POST: otpSend } = await import("@/app/api/auth/otp/send/route");
const { POST: webhook } = await import("@/app/api/telegram/verify/route");
const { handoffSignIn } = await import("@/lib/authHandoff");
const { telegramSignIn } = await import("@/lib/tgLink");
const { SIGNUP_COOKIE } = await import("@/lib/tgSignup");

const PASSWORD = "s3cret-pass";
const form = (phone: string, extra: Record<string, unknown> = {}) => ({
  name: "Hana Tesfaye", phone, password: PASSWORD, ...extra,
});

let ip = 0;
async function submit(phone: string, opts: { cookie?: string; extra?: Record<string, unknown> } = {}) {
  const res = await register(req("POST", "/api/auth/register", {
    body: form(phone, opts.extra),
    headers: { "x-forwarded-for": `10.0.0.${++ip}` },
    ...(opts.cookie ? { cookies: { [SIGNUP_COOKIE]: opts.cookie } } : {}),
  }));
  const cookie = res.cookies.get(SIGNUP_COOKIE)?.value;
  const { status: code, body } = await json<{ pending?: { token: string; url: string }; error?: string }>(res);
  return { code, body, cookie, token: body.pending?.token ?? "" };
}

const poll = async (token: string, cookie?: string) =>
  (await json<Record<string, string>>(await status(req("POST", "/api/auth/register/status", {
    body: { token },
    ...(cookie ? { cookies: { [SIGNUP_COOKIE]: cookie } } : {}),
  })))).body;

let updateId = 5000;
const tg = (message: Record<string, unknown>) =>
  webhook(req("POST", "/api/telegram/verify", {
    headers: { "x-telegram-bot-api-secret-token": SECRET },
    body: { update_id: ++updateId, message },
  }));
const who = (id: number) => ({ chat: { id, type: "private" }, from: { id, is_bot: false, first_name: "Hana", username: `hana${id}` } });
const start = (id: number, token: string) => tg({ message_id: 1, ...who(id), text: `/start ${token}` });
const share = (id: number, phone: string, userId: number = id) =>
  tg({ message_id: 2, ...who(id), contact: { user_id: userId, phone_number: phone } });

const lastText = () => String(sent.at(-1)?.body.text ?? "");
const allMarkup = () => JSON.stringify(sent.map((s) => s.body.reply_markup ?? null));
const usersWith = (phone: string) => prisma.user.count({ where: { phone } });

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  await truncateAll();
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(async () => {
  sent.length = 0;
  await redis.flushall();
});

describe("successful verification", () => {
  test("form → pending only → bot contact → account created, linked, signed in once", async () => {
    const phone = "+251922000001";
    const s = await submit(phone);

    // 1–2. Nothing created; a pending request and a browser cookie.
    expect(s.code).toBe(202);
    expect(s.cookie).toBeTruthy();
    expect(await usersWith(phone)).toBe(0);

    // 3. The link carries only a random token — no phone, name or password.
    expect(s.body.pending!.url).toMatch(/^https:\/\/t\.me\/VinnaTestBot\?start=[0-9a-f]{32}$/);
    expect(s.body.pending!.url).not.toContain("922000001");

    // The stored request holds a bcrypt hash, never the password.
    const raw = (await redis.get(`su:tok:${s.token}`))!;
    expect(raw).not.toContain(PASSWORD);
    expect(raw).toContain("$2");

    // 4. /start shows the share-contact button.
    await start(7001, s.token);
    expect(lastText()).toContain("ending in <b>001</b>");
    expect(JSON.stringify(sent.at(-1)?.body.reply_markup)).toContain("request_contact");

    expect(await poll(s.token, s.cookie)).toEqual({ status: "pending" });

    // 5–6. Own matching contact → account created with Telegram linked.
    await share(7001, "251922000001");
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(user.telegramUserId).toBe("7001");
    expect(user.telegramPhoneVerifiedAt).not.toBeNull();
    expect(user.name).toBe("Hana Tesfaye");
    expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
    expect(user.referralCode).toBeTruthy();

    // 7. Bot offers both ways in.
    expect(allMarkup()).toContain("Play in Telegram");
    expect(allMarkup()).toContain("Continue on Website");
    expect(allMarkup()).toContain("https://vinna.test/auth/continue?t=");

    // 8. The original browser gets exactly one handoff.
    const v = await poll(s.token, s.cookie);
    expect(v.status).toBe("verified");
    expect(v.handoff).toBeTruthy();
    expect((await handoffSignIn(v.handoff))?.id).toBe(user.id);
    expect(await handoffSignIn(v.handoff)).toBeNull(); // single-use
    expect(await poll(s.token, s.cookie)).toEqual({ status: "verified" }); // no second handoff
  });

  test("Continue on Website handoff and the Mini App resolve to the SAME account", async () => {
    const phone = "+251922000002";
    const s = await submit(phone);
    await start(7002, s.token);
    await share(7002, "+251922000002");
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });

    const url = allMarkup().match(/auth\/continue\?t=([A-Za-z0-9_%-]+)/)![1];
    const web = await handoffSignIn(decodeURIComponent(url));
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 7002 }) }, BOT_TOKEN);
    const mini = await telegramSignIn(initData, BOT_TOKEN);

    // One account, one wallet: both platforms sign in to this row.
    expect(web?.id).toBe(user.id);
    expect(mini?.id).toBe(user.id);
    expect(mini?.balance.toString()).toBe("0");
    expect(await prisma.user.count({ where: { telegramUserId: "7002" } })).toBe(1);
  });

  test("a browser that didn't submit the form gets no login and no details", async () => {
    const s = await submit("+251922000003");
    await start(7003, s.token);
    expect(await poll(s.token)).toEqual({ status: "pending" });
    expect(await poll(s.token, "someone-elses-cookie")).toEqual({ status: "pending" });
    await share(7003, "251922000003");
    expect(await poll(s.token, "someone-elses-cookie")).toEqual({ status: "verified" });
  });
});

describe("rejections", () => {
  test("mismatched number → no account, explained in bot and on the page; correcting works", async () => {
    const s = await submit("+251922000010");
    await start(7010, s.token);
    await share(7010, "251933444555");
    expect(await usersWith("+251922000010")).toBe(0);
    expect(lastText()).toContain("don't match");
    expect(lastText()).toContain("555");

    expect(await poll(s.token, s.cookie)).toEqual({
      status: "failed", reason: "mismatch", phoneEnding: "010", sharedEnding: "555",
    });

    // The user corrects the form in the same browser: the old link dies.
    const fixed = await submit("+251933444555", { cookie: s.cookie });
    expect(await poll(s.token, s.cookie)).toEqual({ status: "expired" });
    await start(7010, fixed.token);
    await share(7010, "251933444555");
    expect(await usersWith("+251933444555")).toBe(1);
  });

  test("forwarded / someone else's contact → no account", async () => {
    const s = await submit("+251922000011");
    await start(7011, s.token);
    await share(7011, "251922000011", 9999);
    expect(await usersWith("+251922000011")).toBe(0);
    expect(lastText()).toContain("someone else's contact");
  });

  test("a typed phone number → no account", async () => {
    const s = await submit("+251922000012");
    await start(7012, s.token);
    await tg({ message_id: 3, ...who(7012), text: "+251922000012" });
    expect(await usersWith("+251922000012")).toBe(0);
    expect(lastText()).toContain("can't use a number typed");
  });
});

describe("expiry and retry", () => {
  test("an expired request: link, page and late contact all say so; no account", async () => {
    const s = await submit("+251922000020");
    await start(7020, s.token);
    await redis.del(`su:tok:${s.token}`); // the 15-minute TTL elapsing

    expect(await poll(s.token, s.cookie)).toEqual({ status: "expired" });
    await share(7020, "251922000020");
    expect(lastText()).toContain("expired");
    await start(7020, s.token);
    expect(lastText()).toContain("expired");
    expect(await usersWith("+251922000020")).toBe(0);

    // Retry = submitting again, which works.
    const again = await submit("+251922000020", { cookie: s.cookie });
    expect(again.code).toBe(202);
  });

  test("handoffs expire / are single-use; garbage is refused", async () => {
    expect(await handoffSignIn("not-a-token")).toBeNull();
    expect(await handoffSignIn("A".repeat(43))).toBeNull();
  });

  test("rate limit per phone", async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await submit("+251922000021")).code);
    expect(codes.slice(0, 5).every((c) => c === 202)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});

describe("duplicates", () => {
  test("re-registering an existing number → 409 before anything is stored", async () => {
    await makeUser({ phone: "+251922000030" });
    const s = await submit("+251922000030");
    expect(s.code).toBe(409);
    // also catches a legacy local-format row
    await makeUser({ phone: "0922000031" });
    expect((await submit("+251922000031")).code).toBe(409);
  });

  test("a repeated contact after success never creates a second account", async () => {
    const s = await submit("+251922000032");
    await start(7032, s.token);
    await share(7032, "251922000032");
    await share(7032, "251922000032");
    await start(7032, s.token);
    expect(await usersWith("+251922000032")).toBe(1);
    expect(lastText()).toContain("Where would you like to play");
  });

  test("one Telegram account can't open a second YegaBet account", async () => {
    const a = await submit("+251922000033");
    await start(7033, a.token);
    await share(7033, "251922000033");
    const b = await submit("+251922000034");
    await start(7033, b.token);
    await share(7033, "251922000034");
    expect(await usersWith("+251922000034")).toBe(0);
    expect(await poll(b.token, b.cookie)).toMatchObject({ status: "failed", reason: "telegram-in-use" });
  });

  test("two pending requests for one number: the second to verify gets phone-taken", async () => {
    const a = await submit("+251922000035");
    const b = await submit("+251922000035");
    await start(7035, a.token);
    await share(7035, "251922000035");
    await start(7036, b.token);
    await share(7036, "251922000035");
    expect(await usersWith("+251922000035")).toBe(1);
    expect(await poll(b.token, b.cookie)).toMatchObject({ status: "failed", reason: "phone-taken" });
  });
});

describe("bypass attempts", () => {
  test("POST /api/auth/register with a code (and OTP_DISABLED on) still creates nothing", async () => {
    const s = await submit("+251922000040", { extra: { code: "123456" } });
    expect(s.code).toBe(202);
    expect(await usersWith("+251922000040")).toBe(0);
  });

  test("a foreign number can't skip verification", async () => {
    const s = await submit("+15551234567");
    expect(s.code).toBe(400);
    expect(await prisma.user.count({ where: { phone: "+15551234567" } })).toBe(0);
    const o = await json(await otpSend(req("POST", "/api/auth/otp/send", { body: { phone: "+15551234567" } })));
    expect(o.status).toBe(400);
  });

  test("otp/send tells the form to use the Telegram flow, never `skip`", async () => {
    const o = await json(await otpSend(req("POST", "/api/auth/otp/send", { body: { phone: "+251922000041" } })));
    expect(o.body).toEqual({ signup: "telegram" });
  });

  test("a forged webhook (wrong secret) can't complete a signup", async () => {
    const s = await submit("+251922000042");
    const res = await webhook(req("POST", "/api/telegram/verify", {
      headers: { "x-telegram-bot-api-secret-token": "guess" },
      body: { update_id: 1, message: { message_id: 1, ...who(7042), text: `/start ${s.token}` } },
    }));
    expect(res.status).toBe(404);
    expect(await usersWith("+251922000042")).toBe(0);
  });

  test("password reset via the bot still works (existing feature)", async () => {
    await makeUser({ phone: "+251922000043" });
    process.env.AUTH_OTP_CHANNEL = "telegram";
    try {
      const o = await json<{ telegram?: { token: string } }>(
        await otpSend(req("POST", "/api/auth/otp/send", { body: { phone: "+251922000043", purpose: "reset" } })),
      );
      expect(o.body.telegram?.token).toMatch(/^[0-9a-f]{32}$/);
      await start(7043, o.body.telegram!.token);
      expect(lastText()).toContain("password reset");
      await share(7043, "251922000043");
      expect(lastText()).toContain("Number confirmed");
    } finally {
      delete process.env.AUTH_OTP_CHANNEL;
    }
  });
});
