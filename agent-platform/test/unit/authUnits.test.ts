import { HttpException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthController, describe as describePrincipal, toHttp } from "../../src/auth/auth.controller";
import { BOT_TOKEN, BOT_USERNAME, signWidget } from "../telegramSign";
import { Auth, AuthError, actorOf } from "../../src/auth/auth.service";
import { PrincipalMiddleware, sessionToken } from "../../src/auth/principal.middleware";
import { RateLimiter } from "../../src/auth/rateLimit";
import type { Principal } from "../../src/auth/rbac";
import { Sessions, sha256 } from "../../src/auth/sessions";
import type { BotCall } from "../../src/telegram/bot";
import { TelegramApi } from "../../src/telegram/telegram.controller";
import { telegramApiFor } from "../../src/auth/auth.module";

describe("RateLimiter", () => {
  it("allows the limit, refuses the next with 429, and resets in a new window", () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    rl.hit("ip");
    rl.hit("ip");
    rl.hit("ip");
    expect(() => rl.hit("ip")).toThrow(HttpException);
    try {
      rl.hit("ip");
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
    rl.hit("other"); // separate key
    t = 1000;
    rl.hit("ip"); // new window
  });

  it("forgets expired windows when the map gets very large", () => {
    let t = 0;
    const rl = new RateLimiter(1, 10, () => t);
    for (let i = 0; i <= 50_000; i++) rl.hit(`k${i}`);
    t = 100;
    rl.hit("trigger-sweep"); // sweeps all expired keys
    rl.hit("k1"); // k1 was swept, so this is a fresh window
    expect(() => rl.hit("k1")).toThrow(HttpException);
  });
});

describe("sessionToken", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as never;
  it("reads Bearer first, then the cookie", () => {
    expect(sessionToken(req({ authorization: "Bearer abc" }))).toBe("abc");
    expect(sessionToken(req({ authorization: "Bearer   " }))).toBeUndefined();
    expect(sessionToken(req({ cookie: "a=1; ap_session=tok%2Bx; b=2" }))).toBe("tok+x");
    expect(sessionToken(req({ cookie: "ap_session=" }))).toBeUndefined();
    expect(sessionToken(req({ cookie: "other=1" }))).toBeUndefined();
    expect(sessionToken(req({ authorization: "Basic x" }))).toBeUndefined();
    expect(sessionToken(req({}))).toBeUndefined();
  });

  it("passes a session lookup failure on to the error handler", async () => {
    const mw = new PrincipalMiddleware({
      resolve: () => Promise.reject(new Error("db down")),
    } as unknown as Sessions);
    const next = jest.fn();
    await mw.use({ headers: {} } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "db down" }));
  });
});

describe("error mapping and helpers", () => {
  const status = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return e instanceof HttpException ? e.getStatus() : "raw";
    }
  };
  it("maps auth errors to HTTP and rethrows anything else unchanged", () => {
    expect(status(() => toHttp(new AuthError("NO_ACCOUNT", "x")))).toBe(403);
    expect(status(() => toHttp(new AuthError("UNKNOWN_CODE", "x")))).toBe(404);
    expect(status(() => toHttp(new AuthError("CODE_USED", "x")))).toBe(410);
    expect(status(() => toHttp(new AuthError("INVALID_REFERRAL", "x")))).toBe(400);
    expect(status(() => toHttp(new AuthError("BAD_REQUEST", "x")))).toBe(400);
    expect(status(() => toHttp(new Error("boom")))).toBe("raw");
  });

  it("describes and attributes every principal kind", () => {
    const staff: Principal = { kind: "staff", staffId: 1n, roles: ["owner"] };
    const member: Principal = { kind: "agent_member", memberId: 2n, agentId: 3n };
    const player: Principal = { kind: "player", playerId: 4n };
    expect(describePrincipal(staff)).toEqual({ kind: "staff", staffId: "1", roles: ["owner"] });
    expect(describePrincipal(member)).toEqual({ kind: "agent_member", memberId: "2", agentId: "3" });
    expect(describePrincipal(player)).toEqual({ kind: "player", playerId: "4" });
    expect([actorOf(staff), actorOf(member), actorOf(player)].map((a) => a.actorId)).toEqual(["1", "2", "4"]);
    expect(sha256("x")).toHaveLength(64);
  });

  it("refuses a status code that lost the race to consume it", async () => {
    const db = {
      webSignup: {
        findUnique: async () => ({
          playerId: 1n,
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaClient;
    await expect(new Auth(db, {} as Sessions).webSignupStatus("code", {})).rejects.toMatchObject({
      code: "CODE_USED",
    });
  });
});

describe("Sessions.create", () => {
  it("stores no IP or user agent when there are none, and trims a huge user agent", async () => {
    const rows: Record<string, unknown>[] = [];
    const db = {
      session: { create: async ({ data }: { data: Record<string, unknown> }) => rows.push(data) },
    };
    const sessions = new Sessions(db as unknown as PrismaClient, 60_000);
    const { token } = await sessions.create({ kind: "player", id: 1n });
    await sessions.create({ kind: "player", id: 1n, ip: "1.2.3.4", userAgent: "u".repeat(500) });
    expect(rows[0]).toMatchObject({ ip: null, userAgent: null, tokenHash: sha256(token) });
    expect((rows[1]?.userAgent as string).length).toBe(300);
  });
});

describe("TelegramApi", () => {
  it("uses the global fetch by default, and exists only once a token is set", () => {
    expect(new TelegramApi("t")).toBeInstanceOf(TelegramApi);
    expect(telegramApiFor({ TELEGRAM_BOT_TOKEN: "123:abc" })).toBeInstanceOf(TelegramApi);
    expect(telegramApiFor({ TELEGRAM_BOT_TOKEN: undefined })).toBeNull();
  });
  const call: BotCall = { method: "sendMessage", body: { chat_id: 1, text: "hi" } };
  it("posts the call to the Bot API with the token in the path", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }) as Response);
    await new TelegramApi("123:abc", fetchImpl as unknown as typeof fetch).call(call);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:abc/sendMessage",
      expect.objectContaining({ method: "POST", body: JSON.stringify(call.body) }),
    );
  });
  it("throws when Telegram answers an error", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400 }) as Response;
    await expect(new TelegramApi("t", fetchImpl as unknown as typeof fetch).call(call)).rejects.toThrow(
      "HTTP 400",
    );
  });
});

describe("widget callback", () => {
  it("lets an unexpected error through instead of hiding it in a redirect", async () => {
    const ctl = new AuthController(
      { login: () => Promise.reject(new Error("db down")) } as unknown as Auth,
      { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_BOT_USERNAME: BOT_USERNAME } as never,
    );
    const req = { ip: "9.9.9.9", headers: {} } as never;
    const res = { redirect: jest.fn(), cookie: jest.fn() } as never;
    await expect(ctl.widgetCallback(req, res, { ...signWidget(42), as: "player" })).rejects.toThrow(
      "db down",
    );
  });
});
