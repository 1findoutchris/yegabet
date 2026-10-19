import type { PrismaClient } from "@prisma/client";
import { setFlag } from "../../src/config/featureFlags";
import { Ledger } from "../../src/ledger/ledger";
import { sha256 } from "../../src/auth/sessions";
import { SIGNUP_FLAG, SignupBot, type BotCall, type TgUpdate } from "../../src/telegram/bot";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

jest.setTimeout(120_000);

let db: PrismaClient;
let players: Players;
let hierarchy: Hierarchy;
let bot: SignupBot;
let id = 800_000_000;
const uid = () => String(++id);
let seq = 0;
const phone = () => `+25192${String(1_000_000 + ++seq).slice(-7)}`;

beforeAll(async () => {
  db = testPrisma();
  const ledger = new Ledger(db);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
  hierarchy = new Hierarchy(db, ledger);
  bot = new SignupBot(db, players, { brand: "YegaBet", webappUrl: "https://app.example/tg" });
  await setFlag(db, SIGNUP_FLAG, true, "test");
});
afterAll(() => db.$disconnect());

const texts = (calls: BotCall[]) => calls.map((c) => c.body.text).filter(Boolean);
const start = (u: string, payload = "") =>
  bot.handle({
    message: { from: { id: u }, chat: { id: u }, text: payload ? `/start ${payload}` : "/start" },
  });
const press = (u: string, data: string, withMessage = true): Promise<BotCall[]> =>
  bot.handle({
    callback_query: {
      id: "q",
      from: { id: u },
      data,
      ...(withMessage ? { message: { chat: { id: u } } } : {}),
    },
  });
const share = (u: string, number: string, owner: string | undefined = u) =>
  bot.handle({
    message: { from: { id: u }, chat: { id: u }, contact: { phone_number: number, user_id: owner } },
  });

describe("conversation", () => {
  it("ignores updates without a sender and answers unknown text with help", async () => {
    expect(await bot.handle({} as TgUpdate)).toEqual([]);
    expect(await bot.handle({ message: { chat: { id: 1 }, text: "/start" } })).toEqual([]);
    expect(texts(await bot.handle({ message: { from: { id: 1 }, chat: { id: 1 }, text: "hi" } }))).toEqual([
      "Send /start to create your account.",
    ]);
    expect(texts(await bot.handle({ message: { from: { id: 1 }, chat: { id: 1 } } }))).toEqual([
      "Send /start to create your account.",
    ]);
  });

  it("always answers a button press, and ignores unknown buttons", async () => {
    const calls = await press(uid(), "something-else");
    expect(calls).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "q" } }]);
  });

  it("falls back to the user's own chat when a button press has no message", async () => {
    const u = uid();
    await start(u);
    const calls = await press(u, "age_yes", false);
    expect(calls[1]?.body.chat_id).toBe(u);
  });

  it("asks for 18+ again if the contact comes first, or before confirming", async () => {
    const u = uid();
    expect(texts(await share(u, phone()))).toEqual([expect.stringMatching(/18 or older/)]);
    await start(u);
    expect(texts(await share(u, phone()))).toEqual([expect.stringMatching(/18 or older/)]);
  });

  it("refuses someone else's contact card", async () => {
    const u = uid();
    await start(u);
    await press(u, "age_yes");
    expect(texts(await share(u, phone(), "12345"))).toEqual([expect.stringMatching(/your own number/)]);
    // A contact card with no Telegram user behind it at all.
    const noOwner = await bot.handle({
      message: { from: { id: u }, chat: { id: u }, contact: { phone_number: phone() } },
    });
    expect(texts(noOwner)).toEqual([expect.stringMatching(/your own number/)]);
    expect(await db.player.count({ where: { telegramUserId: u } })).toBe(0);
  });

  it("signs up a direct player (company agent), even if 18+ comes before /start", async () => {
    const u = uid();
    await press(u, "age_yes"); // no intent yet
    const calls = await share(u, phone());
    expect(texts(calls)).toEqual([
      expect.stringMatching(/account is ready/),
      "Where would you like to play?",
    ]);
    const p = await db.player.findUniqueOrThrow({ where: { telegramUserId: u } });
    expect(p.agentId).toBe((await hierarchy.companyAgent()).id);
    expect(await db.signupIntent.count({ where: { telegramUserId: u } })).toBe(0);
    // Back again: already registered, everywhere.
    expect(texts(await start(u))).toEqual(["You already have an account."]);
    expect(texts(await press(u, "age_yes"))).toEqual(["You already have an account."]);
  });

  it("an invalid, paused or company referral offers signing up directly", async () => {
    const company = await hierarchy.companyAgent();
    const paused = await hierarchy.createAgent({ slug: `bot-p-${process.pid}`, displayName: "P" });
    await db.agent.update({ where: { id: paused.id }, data: { status: "paused" } });
    for (const slug of ["nobody-here", paused.slug, company.slug]) {
      const u = uid();
      const calls = await start(u, slug);
      expect(texts(calls)).toEqual([expect.stringMatching(/not valid/)]);
      expect(await db.signupIntent.count({ where: { telegramUserId: u } })).toBe(0);
      // [Sign up directly] → company agent.
      expect(texts((await press(u, "direct")).slice(1))).toEqual([expect.stringMatching(/18 or older/)]);
    }
  });

  it("tells the player when the agent was paused between /start and the contact", async () => {
    const a = await hierarchy.createAgent({ slug: `bot-a-${process.pid}`, displayName: "A" });
    const u = uid();
    await start(u, a.slug);
    await press(u, "age_yes");
    await db.agent.update({ where: { id: a.id }, data: { status: "paused" } });
    expect(texts(await share(u, phone()))).toEqual([expect.stringMatching(/not valid/)]);
  });

  it("refuses foreign numbers and a phone that's already registered", async () => {
    const u = uid();
    await start(u);
    await press(u, "age_yes");
    expect(texts(await share(u, "+1 555 123 4567"))).toEqual([expect.stringMatching(/Ethiopian mobile/)]);

    const first = uid();
    const num = phone();
    await start(first);
    await press(first, "age_yes");
    await share(first, num);
    const second = uid();
    await start(second);
    await press(second, "age_yes");
    expect(texts(await share(second, num))).toEqual(["You already have an account."]);
  });

  it("expired website codes are refused", async () => {
    const used = "used-code";
    await db.webSignup.create({
      data: { codeHash: sha256(used), expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() },
    });
    const old = "old-code";
    await db.webSignup.create({ data: { codeHash: sha256(old), expiresAt: new Date(0) } });
    for (const code of [used, old, "never-issued"]) {
      expect(texts(await start(uid(), `w_${code}`))).toEqual([expect.stringMatching(/expired/)]);
    }
  });

  it("an expired intent counts as none", async () => {
    const u = uid();
    await start(u);
    await press(u, "age_yes");
    await db.signupIntent.update({ where: { telegramUserId: u }, data: { expiresAt: new Date(0) } });
    expect(texts(await share(u, phone()))).toEqual([expect.stringMatching(/18 or older/)]);
  });

  it("without a Mini App address it skips the buttons", async () => {
    const plain = new SignupBot(db, players, { brand: "YegaBet" });
    const u = uid();
    await plain.handle({ message: { from: { id: u }, chat: { id: u }, text: "/start" } });
    await plain.handle({ callback_query: { id: "q", from: { id: u }, data: "age_yes" } });
    const calls = await plain.handle({
      message: { from: { id: u }, chat: { id: u }, contact: { phone_number: phone(), user_id: u } },
    });
    expect(texts(calls)).toEqual([expect.stringMatching(/account is ready/)]);
    expect(
      (await plain.handle({ message: { from: { id: u }, chat: { id: u }, text: "/start" } }))[0]?.body,
    ).not.toHaveProperty("reply_markup");
  });

  it("lets unexpected errors through so Telegram retries", async () => {
    const broken = new SignupBot(
      db,
      { register: () => Promise.reject(new Error("db down")) } as unknown as Players,
      {
        brand: "YegaBet",
      },
    );
    const u = uid();
    await broken.handle({ message: { from: { id: u }, chat: { id: u }, text: "/start" } });
    await broken.handle({ callback_query: { id: "q", from: { id: u }, data: "age_yes" } });
    await expect(
      broken.handle({
        message: { from: { id: u }, chat: { id: u }, contact: { phone_number: phone(), user_id: u } },
      }),
    ).rejects.toThrow("db down");
  });
});

describe("sign-ups closed (flag off)", () => {
  it("says sign-ups open soon at every step, and writes nothing", async () => {
    await setFlag(db, SIGNUP_FLAG, false, "test");
    try {
      const u = uid();
      expect(texts(await start(u))).toEqual([expect.stringMatching(/open soon/)]);
      expect(texts((await press(u, "age_yes")).slice(1))).toEqual([expect.stringMatching(/open soon/)]);
      expect(texts(await share(u, phone()))).toEqual([expect.stringMatching(/open soon/)]);
      expect(await db.signupIntent.count({ where: { telegramUserId: u } })).toBe(0);
      expect(await db.player.count({ where: { telegramUserId: u } })).toBe(0);
    } finally {
      await setFlag(db, SIGNUP_FLAG, true, "test");
    }
  });
});
