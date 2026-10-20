import { createHmac } from "node:crypto";
import {
  MAX_SKEW_S,
  answer,
  error,
  fromProviderPlayerId,
  parse,
  santim,
  toProviderPlayerId,
  verifySignature,
} from "../../src/providers/octhera/adapter";
import { OctheraClient, OctheraError } from "../../src/providers/octhera/client";
import { octheraClientFor } from "../../src/providers/providers.module";

const SECRET = "wallet-secret";
const now = () => Math.floor(Date.now() / 1000);
const sign = (body: string, ts: number, secret = SECRET) =>
  `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

describe("signature", () => {
  const body = '{"type":"ping"}';
  it("accepts a fresh, correctly signed body, and either of two signatures during rotation", () => {
    const ts = now();
    expect(verifySignature(body, String(ts), sign(body, ts), SECRET)).toBe(true);
    expect(
      verifySignature(
        body,
        String(ts),
        `${sign(body, ts, "old")}, ${sign(body, ts).toUpperCase().replace("V1=", "v1=")}`,
        SECRET,
      ),
    ).toBe(true);
  });
  it("refuses a wrong secret, a changed body, an old or malformed timestamp, a missing secret", () => {
    const ts = now();
    expect(verifySignature(body, String(ts), sign(body, ts, "nope"), SECRET)).toBe(false);
    expect(verifySignature(`${body} `, String(ts), sign(body, ts), SECRET)).toBe(false);
    expect(
      verifySignature(body, String(ts - MAX_SKEW_S - 10), sign(body, ts - MAX_SKEW_S - 10), SECRET),
    ).toBe(false);
    expect(verifySignature(body, "abc", sign(body, ts), SECRET)).toBe(false);
    expect(verifySignature(body, String(ts), sign(body, ts), undefined)).toBe(false);
    expect(verifySignature(body, String(ts), "v2=abc, nonsense", SECRET)).toBe(false);
    expect(verifySignature(body, String(ts), "v1=short", SECRET)).toBe(false);
  });
});

describe("amounts and ids", () => {
  it("converts birr to santim exactly, refusing anything finer than a santim", () => {
    expect(santim(20)).toBe(2000n);
    expect(santim(0.1 + 0.2)).toBe(30n); // float noise is absorbed
    expect(santim(12.34)).toBe(1234n);
    expect(santim(0)).toBe(0n);
    for (const bad of [12.345, -1, Infinity, NaN, "10", null, 1e14]) expect(santim(bad)).toBeNull();
  });
  it("maps player ids both ways", () => {
    expect(toProviderPlayerId(42n)).toBe("yb_42");
    expect(fromProviderPlayerId("yb_42")).toBe(42n);
    for (const bad of ["42", "yb_", "yb_4x", 42, undefined, "clx123"])
      expect(fromProviderPlayerId(bad)).toBeNull();
  });
});

describe("parse", () => {
  const base = { version: 2, txnId: "t1", playerId: "yb_7", currency: "ETB", betAmount: 20, winAmount: 0 };
  it("parses ping, debit, credit and rollback", () => {
    expect(parse({ type: "ping" }, "ETB")).toEqual({ kind: "ping" });
    const d = parse({ ...base, type: "debit", action: "bet", gameUid: "g", gameRound: "r" }, "ETB");
    expect(d).toMatchObject({
      kind: "call",
      call: { type: "debit", action: "bet", playerId: 7n, bet: 2000n, win: 0n, gameRound: "r" },
    });
    expect(parse({ ...base, type: "credit", action: "refund" }, "ETB")).toMatchObject({
      call: { action: "refund", gameUid: null },
    });
    expect(parse({ ...base, type: "rollback", action: "whatever" }, "ETB")).toMatchObject({
      call: { type: "rollback", action: null },
    });
    expect(parse({ ...base, type: "debit", action: "bet", playerId: "nope" }, "ETB")).toMatchObject({
      call: { playerId: null },
    });
  });
  it("refuses everything else with a reason", () => {
    const why = (b: unknown) => (parse(b, "ETB") as { why?: string }).why;
    expect(why(null)).toMatch(/object/);
    expect(why({ ...base, version: 1, type: "debit" })).toMatch(/version/);
    expect(why({ ...base, type: "transfer" })).toMatch(/type/);
    expect(why({ ...base, type: "debit", action: "bet", txnId: "" })).toMatch(/txnId/);
    expect(why({ ...base, type: "debit", action: "bet", betAmount: 1.234 })).toMatch(/amounts/);
    expect(why({ ...base, type: "debit", action: "bet", currency: "USD" })).toMatch(/currency USD/);
    expect(why({ ...base, type: "debit", action: "win" })).toMatch(/debit action/);
    expect(why({ ...base, type: "credit", action: "bet" })).toMatch(/credit action/);
    expect(why({ ...base, type: "credit" })).toMatch(/credit action/);
  });
});

describe("answers", () => {
  it("formats ok and error results in birr", () => {
    expect(answer({ ok: true, balance: 12_345n })).toEqual({ status: "ok", balance: 123.45 });
    expect(answer({ ok: true })).toEqual({ status: "ok" });
    expect(answer({ ok: false, code: "INSUFFICIENT_FUNDS", balance: 500n })).toEqual({
      status: "error",
      code: "INSUFFICIENT_FUNDS",
      balance: 5,
    });
    expect(error("INVALID_REQUEST")).toEqual({ status: "error", code: "INVALID_REQUEST" });
  });
});

describe("OctheraClient", () => {
  const res = (status: number, body: string) =>
    ({ ok: status < 400, status, text: async () => body }) as Response;
  it("lists games and launches with the bearer key", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.includes("/launch")
        ? res(200, '{"status":"ok","launchUrl":"https://play/x"}')
        : res(200, '{"status":"ok","total":1,"games":[]}');
    };
    const c = new OctheraClient("key-1", "https://api.example/v2/", fetchImpl as unknown as typeof fetch);
    expect(await c.listGames(1, 200)).toMatchObject({ total: 1 });
    expect(await c.launch({ playerId: "yb_1", balance: 5, gameUid: "g", device: "mobile" })).toBe(
      "https://play/x",
    );
    expect(calls[0]?.[0]).toBe("https://api.example/v2/games?page=1&perPage=200");
    expect((calls[0]?.[1].headers as Record<string, string>).authorization).toBe("Bearer key-1");
    expect((calls[0]?.[1].headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
      playerId: "yb_1",
      balance: 5,
      gameUid: "g",
      device: "mobile",
      lang: "en",
    });
  });
  it("turns failures into OctheraError", async () => {
    const make = (r: Response) =>
      new OctheraClient("k", undefined, (async () => r) as unknown as typeof fetch);
    await expect(
      make(res(403, '{"status":"fail","message":"IP is not allowed"}')).listGames(1, 1),
    ).rejects.toThrow("Octhera 403: IP is not allowed");
    await expect(make(res(500, "<html>")).listGames(1, 1)).rejects.toThrow(/non-JSON/);
    await expect(make(res(502, "")).listGames(1, 1)).rejects.toThrow(/request failed/);
    await expect(
      make(res(200, '{"status":"ok"}')).launch({
        playerId: "p",
        balance: 0,
        gameUid: "g",
        device: "desktop",
      }),
    ).rejects.toThrow(OctheraError);
  });
  it("is only built once an API key is set", () => {
    expect(octheraClientFor({ OCTHERA_API_KEY: "k", OCTHERA_BASE_URL: "https://x" })).toBeInstanceOf(
      OctheraClient,
    );
    expect(octheraClientFor({ OCTHERA_API_KEY: undefined, OCTHERA_BASE_URL: "https://x" })).toBeNull();
    expect(new OctheraClient("k")).toBeInstanceOf(OctheraClient);
  });
});
