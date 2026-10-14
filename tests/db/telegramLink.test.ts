import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { signInitData } from "@/lib/tgInitDataCore";
import { truncateAll, makeUser } from "../factories";
import { json, req } from "../helpers/req";

/*
 * The YegaBet bot's account linking and the Mini App sign-in, end to end
 * through the real webhook route and the real database.
 *
 * What matters most here: a link is only ever made from the sender's OWN
 * contact card, it never touches the wallet, and it never silently moves.
 */

// Outbound Bot API calls are captured instead of sent.
const sent: { method: string; body: Record<string, unknown> }[] = [];
vi.mock("@/lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram")>();
  return {
    ...actual,
    tgCall: async (_token: string | undefined, method: string, body: Record<string, unknown>) => {
      sent.push({ method, body });
    },
  };
});

const BOT_TOKEN = "123456:TEST-verify-bot";
const SECRET = "test-webhook-secret";
const ENV = {
  TELEGRAM_VERIFY_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_VERIFY_BOT_USERNAME: "VinnaTestBot",
  TELEGRAM_VERIFY_WEBHOOK_SECRET: SECRET,
  NEXT_PUBLIC_APP_URL: "https://vinna.test",
};
const saved: Record<string, string | undefined> = {};

const { POST: webhook } = await import("@/app/api/telegram/verify/route");
const { POST: miniapp } = await import("@/app/api/telegram/miniapp/route");
const { telegramSignIn } = await import("@/lib/tgLink");

let updateId = 1000;
function update(message: Record<string, unknown>, opts: { secret?: string; id?: number } = {}) {
  return webhook(
    req("POST", "/api/telegram/verify", {
      headers: { "x-telegram-bot-api-secret-token": opts.secret ?? SECRET },
      body: { update_id: opts.id ?? ++updateId, message },
    }),
  );
}

const TG = 424242;
const from = (id = TG) => ({ id, is_bot: false, first_name: "Abebe", username: "abebe_tg" });
const chat = (id = TG) => ({ id, type: "private" });
const contactMsg = (contact: Record<string, unknown>, sender = TG) => ({
  message_id: 1, chat: chat(sender), from: from(sender), contact,
});
const textMsg = (text: string, sender = TG) => ({ message_id: 1, chat: chat(sender), from: from(sender), text });

const lastText = () => String(sent.at(-1)?.body.text ?? "");
const allText = () => sent.map((s) => String(s.body.text ?? "")).join("\n---\n");

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  await truncateAll();
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  sent.length = 0;
  await redis.flushall();
  await prisma.user.updateMany({ data: { telegramUserId: null, telegramLinkedAt: null, telegramPhoneVerifiedAt: null } });
});

describe("webhook authentication", () => {
  test("wrong or missing secret → 404, nothing processed", async () => {
    const res = await update(textMsg("/start"), { secret: "nope" });
    expect(res.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  test("a redelivered update_id is processed once", async () => {
    await update(textMsg("/start"), { id: 5 });
    await update(textMsg("/start"), { id: 5 });
    expect(sent).toHaveLength(1);
  });

  test("/start shows the main menu with all four buttons", async () => {
    await update(textMsg("/start"));
    expect(lastText()).toContain("Welcome to YegaBet");
    const kb = JSON.stringify(sent.at(-1)?.body.reply_markup);
    for (const label of ["Verify Phone Number", "Open YegaBet", "Check Ticket", "Support"]) expect(kb).toContain(label);
    expect(kb).toContain("https://vinna.test/tg");
  });

  test("group chats are ignored", async () => {
    await update({ message_id: 1, chat: { id: -100, type: "group" }, from: from(), text: "/start" });
    expect(sent).toHaveLength(0);
  });
});

describe("linking by contact", () => {
  test("own contact matching an account → linked, wallet untouched", async () => {
    const u = await makeUser({ phone: "+251911000001", balance: 250, depositBalance: 100 });
    await update(contactMsg({ user_id: TG, phone_number: "251911000001" }));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.telegramUserId).toBe(String(TG));
    expect(after.telegramUsername).toBe("abebe_tg");
    expect(after.telegramFirstName).toBe("Abebe");
    expect(after.telegramLinkedAt).not.toBeNull();
    expect(after.telegramPhoneVerifiedAt).not.toBeNull();
    // Nothing else moved.
    expect(Number(after.balance)).toBe(250);
    expect(Number(after.depositBalance)).toBe(100);
    expect(after.passwordHash).toBe(u.passwordHash);
    expect(after.phone).toBe(u.phone);
    expect(allText()).toContain("Linked!");
  });

  test("a FORWARDED contact (someone else's user_id) never links", async () => {
    const u = await makeUser({ phone: "+251911000002" });
    await update(contactMsg({ user_id: 999, phone_number: "251911000002" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).telegramUserId).toBeNull();
    expect(lastText()).toContain("someone else's contact");
  });

  test("a contact with no user_id (address-book entry) never links", async () => {
    const u = await makeUser({ phone: "+251911000003" });
    await update(contactMsg({ phone_number: "251911000003" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).telegramUserId).toBeNull();
  });

  test("a phone number typed as text is refused", async () => {
    const u = await makeUser({ phone: "+251911000004" });
    await update(textMsg("+251911000004"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).telegramUserId).toBeNull();
    expect(lastText()).toContain("can't use a number typed");
  });

  test("no account → the spec's message, and no user is created", async () => {
    const before = await prisma.user.count();
    await update(contactMsg({ user_id: TG, phone_number: "251944999999" }));
    expect(allText()).toContain("No YegaBet account was found for this phone number.");
    expect(JSON.stringify(sent.at(-1)?.body.reply_markup)).toContain("Create Account");
    expect(JSON.stringify(sent.at(-1)?.body.reply_markup)).toContain("Try Another Account Method");
    expect(await prisma.user.count()).toBe(before);
  });

  test("a legacy local-format phone row is still found", async () => {
    const u = await makeUser({ phone: "0911000005" });
    await update(contactMsg({ user_id: TG, phone_number: "+251 91 100 0005" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).telegramUserId).toBe(String(TG));
  });

  test("one Telegram can't be linked to a second account silently", async () => {
    const a = await makeUser({ phone: "+251911000006" });
    const b = await makeUser({ phone: "+251911000007" });
    await prisma.user.update({ where: { id: a.id }, data: { telegramUserId: String(TG) } });

    await update(contactMsg({ user_id: TG, phone_number: "251911000007" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).telegramUserId).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).telegramUserId).toBe(String(TG));
    expect(lastText()).toContain("/unlink");
  });

  test("an account linked to another Telegram is not taken over", async () => {
    const u = await makeUser({ phone: "+251911000008" });
    await prisma.user.update({ where: { id: u.id }, data: { telegramUserId: "111" } });
    await update(contactMsg({ user_id: TG, phone_number: "251911000008" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).telegramUserId).toBe("111");
  });

  test("banned accounts and in-person agents can't be linked", async () => {
    const banned = await makeUser({ phone: "+251911000009", isActive: false });
    await update(contactMsg({ user_id: TG, phone_number: "251911000009" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: banned.id } })).telegramUserId).toBeNull();

    const agent = await makeUser({ phone: "+251911000010" });
    await prisma.user.update({ where: { id: agent.id }, data: { role: "IN_PERSON_AGENT" } });
    await update(contactMsg({ user_id: TG, phone_number: "251911000010" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: agent.id } })).telegramUserId).toBeNull();
  });

  test("/unlink releases it, and only the telegram columns change", async () => {
    const u = await makeUser({ phone: "+251911000011", balance: 40 });
    await update(contactMsg({ user_id: TG, phone_number: "251911000011" }));
    await update(textMsg("/unlink"));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.telegramUserId).toBeNull();
    expect(Number(after.balance)).toBe(40);
  });

  test("a pending SIGNUP verification still owns the contact (original flow intact)", async () => {
    const { beginVerification } = await import("@/lib/tgVerify");
    const { token } = await beginVerification("+251911000012", "register");
    await update(textMsg(`/start ${token}`));
    expect(lastText()).toContain("sign-up");
    await update(contactMsg({ user_id: TG, phone_number: "251911000012" }));
    expect(lastText()).toContain("Number confirmed");
    // And the code the signup page collects exists.
    const { takeCode } = await import("@/lib/tgVerify");
    expect(await takeCode(token)).toMatch(/^\d{6}$/);
  });
});

describe("/account and /ticket", () => {
  test("/account shows the linked summary with a masked phone", async () => {
    const u = await makeUser({ phone: "+251911000013", balance: 1234.5, name: "Sara" });
    await prisma.user.update({ where: { id: u.id }, data: { telegramUserId: String(TG) } });
    await update(textMsg("/account"));
    expect(lastText()).toContain("Sara");
    expect(lastText()).toContain("ETB 1,234.50");
    expect(lastText()).toContain("+251 9•• ••• 013");
    expect(lastText()).not.toContain("+251911000013");
  });

  test("/account when unlinked offers verification", async () => {
    await update(textMsg("/account"));
    expect(lastText()).toContain("isn't linked");
  });

  test("/ticket asks, then an unknown code says not found", async () => {
    await update(textMsg("/ticket"));
    expect(lastText()).toContain("Check a ticket");
    await update(textMsg("T9ZZZZZ"));
    expect(lastText()).toContain("not found");
  });
});

describe("Mini App status + sign-in (initData)", () => {
  const init = (id = TG, ageSec = 5, extra: Record<string, string> = {}) =>
    signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - ageSec), user: JSON.stringify({ id, first_name: "Abebe" }), ...extra }, BOT_TOKEN);
  const status = (body: unknown) => miniapp(req("POST", "/api/telegram/miniapp", { body }));

  test("unlinked → linked:false, no account data", async () => {
    const r = (await json(await status({ initData: init() }))).body;
    expect(r).toMatchObject({ linked: false, firstName: "Abebe", botUsername: "VinnaTestBot" });
    expect(JSON.stringify(r)).not.toMatch(/balance|phone|accountNo/);
  });

  test("forged / tampered / stale initData → 401", async () => {
    const forged = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: '{"id":1}' }, "999:other");
    expect((await status({ initData: forged })).status).toBe(401);
    const tampered = new URLSearchParams(init());
    tampered.set("user", '{"id":1}');
    expect((await status({ initData: tampered.toString() })).status).toBe(401);
    expect((await status({ initData: init(TG, 2 * 60 * 60) })).status).toBe(401);
  });

  test("an id in the body next to initData is ignored", async () => {
    const r = (await json(await status({ initData: init(), userId: "anything", telegramUserId: 1 }))).body;
    expect(r.linked).toBe(false);
  });

  test("linked → telegramSignIn returns that user; startapp maps through the allow-list", async () => {
    const u = await makeUser({ phone: "+251911000014" });
    await prisma.user.update({ where: { id: u.id }, data: { telegramUserId: String(TG) } });

    const r = (await json(await status({ initData: init(TG, 5, { start_param: "ticket_T3F9K2A" }) }))).body;
    expect(r).toMatchObject({ linked: true, startPath: "/check?code=T3F9K2A" });

    const signedIn = await telegramSignIn(init(), BOT_TOKEN);
    expect(signedIn?.id).toBe(u.id);
  });

  test("telegramSignIn refuses forged, stale, unlinked and banned", async () => {
    const u = await makeUser({ phone: "+251911000015" });
    await prisma.user.update({ where: { id: u.id }, data: { telegramUserId: String(TG) } });

    expect(await telegramSignIn(init(), "999:other")).toBeNull();
    expect(await telegramSignIn(init(TG, 2 * 60 * 60), BOT_TOKEN)).toBeNull();
    expect(await telegramSignIn(init(55555), BOT_TOKEN)).toBeNull();
    expect(await telegramSignIn(init(), undefined)).toBeNull();

    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect(await telegramSignIn(init(), BOT_TOKEN)).toBeNull();
  });

  test("a failed contact share is reported to the polling Mini App", async () => {
    const since = Date.now();
    await update(contactMsg({ user_id: TG, phone_number: "251944888888" }));
    const r = (await json(await status({ initData: init(), since }))).body;
    expect(r).toMatchObject({ linked: false, linkError: "no-account" });
    // An older failure doesn't end a newer poll.
    const later = (await json(await status({ initData: init(), since: Date.now() + 1000 }))).body;
    expect(later.linkError).toBeNull();
  });
});
