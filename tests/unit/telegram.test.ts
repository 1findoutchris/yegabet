import { describe, expect, test } from "vitest";
import { INIT_DATA_MAX_AGE, signInitData, validateInitData } from "@/lib/tgInitDataCore";
import { startPath, ticketStartParam } from "@/lib/tgStartCore";
import { linkDecision, maskPhone, phoneVariants, provenPhone, type LinkCandidate } from "@/lib/tgLinkCore";
import { esc, parseCommand, ticketSummary } from "@/lib/tgBotCore";
import { miniAppUrl } from "@/lib/tgBot";

/*
 * The Telegram integration's security-relevant logic: initData signatures,
 * contact proof, the link decision table, and the deep-link allow-list.
 */

const TOKEN = "123456:TEST-bot-token";
const NOW = 1_800_000_000;
const user = (id = 777, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, first_name: "Abebe", username: "abebe", ...extra });
const signed = (fields: Record<string, string> = {}) =>
  signInitData({ auth_date: String(NOW - 10), query_id: "AAE", user: user(), ...fields }, TOKEN);

describe("validateInitData — Telegram's Mini App signature", () => {
  test("accepts initData signed with our bot token", () => {
    const r = validateInitData(signed({ start_param: "ticket_T3F9K2A" }), TOKEN, NOW);
    expect(r).toMatchObject({ ok: true, user: { id: 777 }, startParam: "ticket_T3F9K2A" });
  });

  test("known-answer: matches Telegram's algorithm, not just our own signer", () => {
    // Computed independently with Python's hmac:
    //   HMAC_SHA256(HMAC_SHA256("WebAppData", token), 'auth_date=1\nuser={"id":1}')
    const hash = "3e44098a9822b37efb6029bb8c059f6c3310efdda793df4946ff3e3cf6bbf625";
    const init = `user=${encodeURIComponent('{"id":1}')}&hash=${hash}&auth_date=1`;
    expect(validateInitData(init, TOKEN, 2, 10)).toMatchObject({ ok: true, user: { id: 1 } });
    expect(validateInitData(init.replace(hash, hash.replace(/^3/, "4")), TOKEN, 2, 10).ok).toBe(false);
  });

  test("the user id can't be swapped — that's the whole point", () => {
    const params = new URLSearchParams(signed());
    params.set("user", user(1));
    expect(validateInitData(params.toString(), TOKEN, NOW)).toEqual({ ok: false, reason: "bad-hash" });
  });

  test("a different bot's token doesn't validate", () => {
    expect(validateInitData(signed(), "999:other", NOW)).toEqual({ ok: false, reason: "bad-hash" });
  });

  test("an added field breaks the signature", () => {
    expect(validateInitData(signed() + "&start_param=account", TOKEN, NOW).ok).toBe(false);
  });

  test("a repeated key is refused (ambiguous which was signed)", () => {
    expect(validateInitData(signed() + "&user=" + encodeURIComponent(user(1)), TOKEN, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("auth_date freshness", () => {
    const old = signInitData({ auth_date: String(NOW - INIT_DATA_MAX_AGE - 1), user: user() }, TOKEN);
    expect(validateInitData(old, TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
    const future = signInitData({ auth_date: String(NOW + 3600), user: user() }, TOKEN);
    expect(validateInitData(future, TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
    const edge = signInitData({ auth_date: String(NOW - INIT_DATA_MAX_AGE), user: user() }, TOKEN);
    expect(validateInitData(edge, TOKEN, NOW).ok).toBe(true);
  });

  test("signature (Bot API 8.0) stays in the check string", () => {
    expect(validateInitData(signed({ signature: "abc" }), TOKEN, NOW).ok).toBe(true);
  });

  test.each([
    ["", "empty"],
    ["hash=zz", "non-hex hash"],
    ["auth_date=1", "no hash"],
  ])("malformed: %s (%s)", (init) => {
    expect(validateInitData(init, TOKEN, NOW)).toMatchObject({ ok: false, reason: "malformed" });
  });

  test("no user, or a non-numeric id, is not an identity", () => {
    expect(validateInitData(signInitData({ auth_date: String(NOW), chat_type: "private" }, TOKEN), TOKEN, NOW))
      .toEqual({ ok: false, reason: "no-user" });
    expect(validateInitData(signInitData({ auth_date: String(NOW), user: '{"id":"777"}' }, TOKEN), TOKEN, NOW))
      .toEqual({ ok: false, reason: "no-user" });
    expect(validateInitData(signInitData({ auth_date: String(NOW), user: '{"id":-5}' }, TOKEN), TOKEN, NOW))
      .toEqual({ ok: false, reason: "no-user" });
  });

  test("no token configured → nothing validates", () => {
    expect(validateInitData(signed(), "", NOW).ok).toBe(false);
  });
});

describe("provenPhone — only your own contact card counts", () => {
  test("own card, Ethiopian number → E.164", () => {
    expect(provenPhone({ user_id: 5, phone_number: "251912345678" }, 5)).toEqual({ ok: true, phone: "+251912345678" });
  });
  test("forwarded card (someone else's user_id)", () => {
    expect(provenPhone({ user_id: 6, phone_number: "251912345678" }, 5)).toEqual({ ok: false, reason: "not-own-contact" });
  });
  test("address-book card with no user_id", () => {
    expect(provenPhone({ phone_number: "251912345678" }, 5)).toEqual({ ok: false, reason: "not-own-contact" });
  });
  test("user_id as a string doesn't pass", () => {
    expect(provenPhone({ user_id: "5", phone_number: "251912345678" }, 5).ok).toBe(false);
  });
  test("foreign number", () => {
    expect(provenPhone({ user_id: 5, phone_number: "+15551234567" }, 5)).toEqual({ ok: false, reason: "not-ethiopian" });
  });
});

describe("linkDecision", () => {
  const u = (o: Partial<LinkCandidate> = {}): LinkCandidate => ({
    id: "u1", isActive: true, role: "USER", telegramUserId: null, ...o,
  });

  test("fresh link", () => expect(linkDecision("777", [u()], null)).toEqual({ do: "link", userId: "u1" }));
  test("already linked to this Telegram → refresh", () =>
    expect(linkDecision("777", [u({ telegramUserId: "777" })], "u1")).toEqual({ do: "refresh", userId: "u1" }));
  test("no account", () => expect(linkDecision("777", [], null)).toEqual({ do: "reject", reason: "no-account" }));
  test("two accounts on one number → refuse, never guess", () =>
    expect(linkDecision("777", [u(), u({ id: "u2" })], null)).toEqual({ do: "reject", reason: "ambiguous" }));
  test("banned", () => expect(linkDecision("777", [u({ isActive: false })], null).do).toBe("reject"));
  test("in-person agents can't sign in through Telegram", () =>
    expect(linkDecision("777", [u({ role: "IN_PERSON_AGENT" })], null)).toEqual({ do: "reject", reason: "unavailable" }));
  test("Telegram already linked to another account → not moved silently", () =>
    expect(linkDecision("777", [u()], "u9")).toEqual({ do: "reject", reason: "telegram-in-use" }));
  test("account linked to a different Telegram → not overwritten (recycled SIM)", () =>
    expect(linkDecision("777", [u({ telegramUserId: "888" })], null)).toEqual({
      do: "reject",
      reason: "account-has-other-telegram",
    }));
});

describe("phone helpers", () => {
  test("variants cover every stored spelling", () => {
    expect(phoneVariants("+251912345678")).toEqual(["+251912345678", "251912345678", "0912345678", "912345678"]);
  });
  test("mask", () => expect(maskPhone("+251912345678")).toBe("+251 9•• ••• 678"));
});

describe("startPath — deep links only navigate, inside our own site", () => {
  test.each([
    ["ticket_T3F9K2A", "/check?code=T3F9K2A"],
    ["ticket_p7kx2m9qd", "/check?code=P7KX2M9QD"],
    ["ticket_nonsense!", null],
    ["ticket_ZZ", "/check"],
    ["game_vs20doghouse", "/game/vs20doghouse"],
    ["promo_42", "/rewards/bonuses"],
    ["event_123", "/sports"],
    ["wallet", "/account"],
    ["Sports", "/sports"],
    ["home", "/tg"],
  ])("%s → %s", (param, path) => expect(startPath(param)).toBe(path));

  test.each([
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "../admin",
    "game_../../admin",
    "admin",
    "game_",
    "",
  ])("rejects %j", (param) => expect(startPath(param)).toBeNull());

  test("ticketStartParam round-trips", () => {
    expect(ticketStartParam("T-3F9K2A")).toBe("ticket_T3F9K2A");
    expect(startPath(ticketStartParam("T-3F9K2A"))).toBe("/check?code=T3F9K2A");
  });
});

describe("bot commands", () => {
  test.each([
    ["/start", { cmd: "start", arg: null }],
    ["/start verify", { cmd: "start", arg: "verify" }],
    ["/start@VinnaBot ticket_T3F9K2A", { cmd: "start", arg: "ticket_T3F9K2A" }],
    ["/TICKET  T3F9K2A ", { cmd: "ticket", arg: "T3F9K2A" }],
    ["/account", { cmd: "account", arg: null }],
    ["/whatever", { cmd: "help", arg: null }],
  ])("%s", (text, expected) => expect(parseCommand(text)).toEqual(expected));

  test("plain text is not a command", () => expect(parseCommand("T3F9K2A")).toBeNull());
  test("HTML escaping", () => expect(esc("<b>&")).toBe("&lt;b&gt;&amp;"));
});

describe("ticketSummary", () => {
  test("stake, status, and a provider-supplied name escaped", () => {
    const text = ticketSummary({
      publicId: "T-3F9K2A",
      status: "PLACED",
      totalStake: "100",
      totalWin: "0",
      bets: [{ betAmount: "100", winAmount: "0", settled: false, gameName: "<script>", info: null, resultInfo: null }],
    });
    expect(text).toContain("Ticket T3F9K2A");
    expect(text).toContain("PLACED");
    expect(text).toContain("100.00 ETB");
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  test("won amount", () => {
    const text = ticketSummary({
      publicId: "P-7KX2M9QD", status: "WON", totalStake: "50", totalWin: "125.5",
      bets: [{ betAmount: "50", winAmount: "125.5", settled: true, gameName: "Sportsbook", info: null, resultInfo: null }],
    });
    expect(text).toContain("Won: <b>125.50 ETB</b>");
  });
});

describe("miniAppUrl", () => {
  const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
  test("defaults to <app>/tg", () =>
    expect(miniAppUrl(undefined, env({ NEXT_PUBLIC_APP_URL: "https://vinna.bet/" }))).toBe("https://vinna.bet/tg"));
  test("section via ?to=", () =>
    expect(miniAppUrl("check", env({ NEXT_PUBLIC_APP_URL: "https://vinna.bet" }))).toBe("https://vinna.bet/tg?to=check"));
  test("explicit override", () =>
    expect(miniAppUrl(undefined, env({ TELEGRAM_WEBAPP_URL: "https://m.vinna.bet/tg" }))).toBe("https://m.vinna.bet/tg"));
  test("never http — Telegram would reject the button", () =>
    expect(miniAppUrl(undefined, env({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }))).toBe(""));
});
