import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as wallet } from "@/app/api/provider/octhera/wallet/route";
import { POST as gamesLaunch } from "@/app/api/games/launch/route";
import { resetCatalogCache } from "@/lib/catalog";
import { makeUser, truncateAll } from "../factories";
import { json, req } from "../helpers/req";
import { asAnon, asUser } from "../helpers/session";

/*
 * Octhera API v2 — company wallet. Players play with their normal VinnaBet
 * balance: Octhera calls /api/provider/octhera/wallet for every bet and win.
 * `fetch` is stubbed for the launch tests — nothing here reaches Octhera.
 */

const SECRET = "test-octhera-wallet-secret";
const ENV = [
  "OCTHERA_API_KEY", "OCTHERA_WALLET_SECRET", "OCTHERA_AVIATOR_GAME_UID", "OCTHERA_BASE_URL",
  "OCTHERA_AVIATOR_PUBLIC", "OCTHERA_GAMES_PUBLIC", "OCTHERA_PAGE", "OCTHERA_CURRENCY", "GAME_CATALOG",
] as const;
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const now = () => String(Math.floor(Date.now() / 1000));
const sign = (ts: string, raw: string, secret = SECRET) =>
  "v1=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");

type WalletReply = { status: string; code?: string; balance?: number };

/** POST a wallet call the way Octhera does: raw JSON, timestamp, v1 signature. */
async function send(body: unknown, opts: { ts?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? now();
  const res = await wallet(req("POST", "/api/provider/octhera/wallet", {
    body: raw,
    headers: {
      "x-octhera-timestamp": ts,
      "x-octhera-signature": opts.signature ?? sign(ts, raw),
      "x-octhera-request-id": `req-${Math.random()}`,
    },
  }));
  return json<WalletReply>(res);
}

let seq = 0;
const call = (playerId: string, over: Record<string, unknown> = {}) => ({
  version: 2, type: "debit", action: "bet", txnId: `t-${++seq}`, playerId, currency: "ETB",
  betAmount: 10, winAmount: 0, gameUid: "aviator-uid", gameName: "Aviator", gameRound: `r-${seq}`,
  occurredAt: "2026-10-04T10:00:00Z",
  ...over,
});
const debit = (playerId: string, over: Record<string, unknown> = {}) => send(call(playerId, over));
const credit = (playerId: string, over: Record<string, unknown> = {}) =>
  send(call(playerId, { type: "credit", action: "win", betAmount: 0, winAmount: 5, ...over }));
const rollback = (playerId: string, txnId: string) =>
  send(call(playerId, { type: "rollback", action: null, txnId, reason: "timeout" }));

const balanceOf = async (id: string) => Number((await prisma.user.findUniqueOrThrow({ where: { id } })).balance);

beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.OCTHERA_API_KEY = "test-key";
  process.env.OCTHERA_WALLET_SECRET = SECRET;
  for (const k of ["OCTHERA_AVIATOR_GAME_UID", "OCTHERA_BASE_URL", "OCTHERA_AVIATOR_PUBLIC", "OCTHERA_GAMES_PUBLIC", "OCTHERA_PAGE", "OCTHERA_CURRENCY", "GAME_CATALOG"]) {
    delete process.env[k];
  }
  delete (globalThis as { __octheraCatalog?: unknown }).__octheraCatalog;
  resetCatalogCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __octheraCatalog?: unknown }).__octheraCatalog;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("wallet — signature and ping", () => {
  test("signed ping → ok, nothing stored", async () => {
    const r = await send({ version: 2, type: "ping", txnId: "p-1", occurredAt: "2026-10-04T10:00:00Z" });
    expect(r).toEqual({ status: 200, body: { status: "ok" } });
    expect(await prisma.octheraWalletTxn.count()).toBe(0);
  });

  test("bad signature, wrong secret, stale or future timestamp → INVALID_SIGNATURE (HTTP 200), no money moved", async () => {
    const p = await makeUser({ balance: 100 });
    const body = call(p.id);
    const raw = JSON.stringify(body);
    const old = String(Math.floor(Date.now() / 1000) - 301);
    const future = String(Math.floor(Date.now() / 1000) + 301);
    for (const r of [
      await send(body, { signature: "v1=deadbeef" }),
      await send(body, { signature: sign(now(), raw, "wrong-secret") }),
      await send(body, { ts: old, signature: sign(old, raw) }),
      await send(body, { ts: future, signature: sign(future, raw) }),
    ]) {
      expect(r).toEqual({ status: 200, body: { status: "error", code: "INVALID_SIGNATURE" } });
    }
    expect(await balanceOf(p.id)).toBe(100);
  });

  test("during secret rotation either of two v1 signatures is accepted", async () => {
    const p = await makeUser({ balance: 100 });
    const body = call(p.id);
    const ts = now();
    const r = await send(body, { ts, signature: `${sign(ts, JSON.stringify(body), "old-secret")},${sign(ts, JSON.stringify(body))}` });
    expect(r.body).toEqual({ status: "ok", balance: 90 });
  });

  test("no OCTHERA_WALLET_SECRET configured → everything refused", async () => {
    delete process.env.OCTHERA_WALLET_SECRET;
    expect((await send({ version: 2, type: "ping", txnId: "p", occurredAt: "x" })).body.code).toBe("INVALID_SIGNATURE");
  });

  test("malformed body or wrong currency → INVALID_REQUEST", async () => {
    const p = await makeUser({ balance: 100 });
    expect((await debit(p.id, { currency: "USD" })).body.code).toBe("INVALID_REQUEST");
    expect((await debit(p.id, { betAmount: -1 })).body.code).toBe("INVALID_REQUEST");
    expect((await debit(p.id, { betAmount: 1.234 })).body.code).toBe("INVALID_REQUEST");
    expect((await debit(p.id, { action: "win" })).body.code).toBe("INVALID_REQUEST");
    expect((await debit(p.id, { version: 1 })).body.code).toBe("INVALID_REQUEST");
    expect(await balanceOf(p.id)).toBe(100);
  });
});

describe("wallet — debit", () => {
  test("accepted bet moves the normal VinnaBet balance and writes a BET transaction", async () => {
    const p = await makeUser({ balance: 100 });
    const r = await debit(p.id, { txnId: "bet-1", betAmount: 10 });
    expect(r).toEqual({ status: 200, body: { status: "ok", balance: 90 } });
    expect(await balanceOf(p.id)).toBe(90);
    const txn = await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:debit:bet-1" } });
    expect(txn).toMatchObject({ userId: p.id, type: "BET", status: "COMPLETED" });
    expect(Number(txn.amount)).toBe(10);
    expect((txn.metadata as { gameId: string }).gameId).toBe("octhera:aviator-uid");
  });

  test("insufficient funds → INSUFFICIENT_FUNDS with the balance; nothing moved; replayed on retry", async () => {
    const p = await makeUser({ balance: 5 });
    const first = await debit(p.id, { txnId: "big", betAmount: 10 });
    expect(first.body).toEqual({ status: "error", code: "INSUFFICIENT_FUNDS", balance: 5 });
    expect(await balanceOf(p.id)).toBe(5);
    expect(await prisma.transaction.count()).toBe(0);
    expect((await debit(p.id, { txnId: "big", betAmount: 10 })).body).toEqual(first.body);
  });

  test("bet_win nets bet and win: needs max(0, bet − win)", async () => {
    const p = await makeUser({ balance: 0 });
    // bet 10, win 15 → needs 0, balance +5
    expect((await debit(p.id, { action: "bet_win", betAmount: 10, winAmount: 15 })).body).toEqual({ status: "ok", balance: 5 });
    // bet 10, win 4 → needs 6; has 5 → refused
    expect((await debit(p.id, { action: "bet_win", betAmount: 10, winAmount: 4 })).body).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await prisma.user.update({ where: { id: p.id }, data: { balance: 6 } });
    expect((await debit(p.id, { action: "bet_win", betAmount: 10, winAmount: 4 })).body).toEqual({ status: "ok", balance: 0 });
  });

  test("duplicate debit → the stored response, money moved once", async () => {
    const p = await makeUser({ balance: 100 });
    const a = await debit(p.id, { txnId: "dup", betAmount: 10 });
    await debit(p.id, { txnId: "x", betAmount: 10 }); // balance now 80
    const b = await debit(p.id, { txnId: "dup", betAmount: 10 });
    expect(b.body).toEqual(a.body); // original response (balance 90), not the current one
    expect(await balanceOf(p.id)).toBe(80);
  });

  test("concurrent debits never overdraw", async () => {
    const p = await makeUser({ balance: 100 });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => debit(p.id, { txnId: `c-${i}`, betAmount: 30 })));
    expect(results.filter((r) => r.body.status === "ok")).toHaveLength(3);
    expect(results.filter((r) => r.body.code === "INSUFFICIENT_FUNDS")).toHaveLength(3);
    expect(await balanceOf(p.id)).toBe(10);
  });

  test("the same debit sent 5× in parallel is applied once", async () => {
    const p = await makeUser({ balance: 100 });
    const body = call(p.id, { txnId: "par", betAmount: 10 });
    const results = await Promise.all(Array.from({ length: 5 }, () => send(body)));
    expect(results.every((r) => r.body.status === "ok" && r.body.balance === 90)).toBe(true);
    expect(await balanceOf(p.id)).toBe(90);
    expect(await prisma.transaction.count()).toBe(1);
  });

  test("blocked player → PLAYER_BLOCKED; unknown player → PLAYER_NOT_FOUND", async () => {
    const p = await makeUser({ balance: 100, isActive: false });
    expect((await debit(p.id)).body).toMatchObject({ status: "error", code: "PLAYER_BLOCKED" });
    expect((await debit("no-such-player")).body).toEqual({ status: "error", code: "PLAYER_NOT_FOUND" });
    expect(await balanceOf(p.id)).toBe(100);
  });
});

describe("wallet — credit", () => {
  test("win adds once per txnId; refund writes a REFUND transaction", async () => {
    const p = await makeUser({ balance: 10 });
    expect((await credit(p.id, { txnId: "w-1", winAmount: 25 })).body).toEqual({ status: "ok", balance: 35 });
    expect((await credit(p.id, { txnId: "w-1", winAmount: 25 })).body).toEqual({ status: "ok", balance: 35 });
    expect(await balanceOf(p.id)).toBe(35);
    expect((await credit(p.id, { txnId: "rf-1", action: "refund", winAmount: 5 })).body).toEqual({ status: "ok", balance: 40 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:credit:rf-1" } })).type).toBe("REFUND");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:credit:w-1" } })).type).toBe("WIN");
  });

  test("a blocked player still gets their win", async () => {
    const p = await makeUser({ balance: 0, isActive: false });
    expect((await credit(p.id, { winAmount: 12.5 })).body).toEqual({ status: "ok", balance: 12.5 });
  });

  test("unknown player → PLAYER_NOT_FOUND, not stored, so a later retry can succeed", async () => {
    expect((await credit("ghost", { txnId: "g-1" })).body).toEqual({ status: "error", code: "PLAYER_NOT_FOUND" });
    expect(await prisma.octheraWalletTxn.count()).toBe(0);
  });
});

describe("wallet — rollback", () => {
  test("rollback after debit restores the balance; repeating it is a no-op", async () => {
    const p = await makeUser({ balance: 100 });
    await debit(p.id, { txnId: "rb-1", betAmount: 10 });
    expect((await rollback(p.id, "rb-1")).body).toEqual({ status: "ok", balance: 100 });
    expect((await rollback(p.id, "rb-1")).body).toEqual({ status: "ok", balance: 100 });
    expect(await balanceOf(p.id)).toBe(100);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:rollback:rb-1" } })).type).toBe("REFUND");
  });

  test("rollback of a winning bet_win takes the net gain back", async () => {
    const p = await makeUser({ balance: 0 });
    await debit(p.id, { txnId: "rb-2", action: "bet_win", betAmount: 10, winAmount: 15 });
    expect(await balanceOf(p.id)).toBe(5);
    expect((await rollback(p.id, "rb-2")).body).toEqual({ status: "ok", balance: 0 });
  });

  test("rollback BEFORE debit leaves a marker: the late debit gets TXN_ROLLED_BACK and moves nothing", async () => {
    const p = await makeUser({ balance: 100 });
    expect((await rollback(p.id, "early")).body).toEqual({ status: "ok", balance: 100 });
    expect((await debit(p.id, { txnId: "early", betAmount: 10 })).body).toEqual({ status: "error", code: "TXN_ROLLED_BACK", balance: 100 });
    expect(await balanceOf(p.id)).toBe(100);
  });

  test("rollback of a refused debit moves nothing", async () => {
    const p = await makeUser({ balance: 5 });
    await debit(p.id, { txnId: "refused", betAmount: 10 });
    expect((await rollback(p.id, "refused")).body).toEqual({ status: "ok", balance: 5 });
    expect(await balanceOf(p.id)).toBe(5);
  });

  test("a credit then rollback of an unrelated txnId doesn't touch the credit", async () => {
    const p = await makeUser({ balance: 0 });
    await credit(p.id, { txnId: "c-1", winAmount: 20 });
    expect((await rollback(p.id, "c-1")).body).toEqual({ status: "ok", balance: 20 });
  });
});

describe("launch (/api/games/launch, game_uid octhera:<gameUid>)", () => {
  const open = (game_uid: string, ua = "Mozilla/5.0 (iPhone)") =>
    gamesLaunch(req("POST", "/api/games/launch", { body: { game_uid }, headers: { "user-agent": ua } }));
  const catalog = () =>
    reply({ status: "ok", total: 1, games: [{ gameUid: "mines-x", name: "Octhera Mines X", provider: "NEWPROV", providerName: "New Provider", type: "Crash" }] });

  test("v2 launch with the player's id and their normal balance; the URL goes to the in-site player", async () => {
    const player = await makeUser({ balance: 42.5 });
    asUser({ id: player.id });
    catalog();
    reply({ status: "ok", launchUrl: "https://api.octhera.org/play?token=abc", transferId: "t" });

    const { status, body } = await json<{ game_launch_url: string }>(await open("octhera:mines-x"));
    expect(status).toBe(200);
    expect(body).toEqual({ game_launch_url: "https://api.octhera.org/play?token=abc" });

    const launch = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/players/launch"))!;
    expect(launch[0]).toBe("https://api.octhera.org/api/v2/players/launch");
    expect(launch[1].headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(launch[1].body)).toEqual({ playerId: player.id, balance: 42.5, gameUid: "mines-x", lang: "en", device: "mobile" });
    expect(await prisma.recentGame.count({ where: { userId: player.id, gameId: "octhera:mines-x" } })).toBe(1);
  });

  test("Aviator tile: switch off → unavailable; on → launches the Aviator gameUid", async () => {
    const player = await makeUser({ balance: 10 });
    asUser({ id: player.id });
    expect((await json<{ unavailable: boolean }>(await open("octhera:aviator"))).body.unavailable).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.OCTHERA_AVIATOR_PUBLIC = "true";
    process.env.OCTHERA_AVIATOR_GAME_UID = "aviator-uid";
    reply({ status: "ok", launchUrl: "https://api.octhera.org/play?token=av" });
    expect((await json<{ game_launch_url: string }>(await open("octhera:aviator"))).body.game_launch_url).toBe("https://api.octhera.org/play?token=av");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).gameUid).toBe("aviator-uid");
  });

  test("a gameUid not in Octhera's catalog → unavailable, never launched", async () => {
    asUser({ id: (await makeUser()).id });
    catalog();
    expect((await json<{ unavailable: boolean }>(await open("octhera:something-else"))).body.unavailable).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/players/launch"))).toBe(false);
  });

  test("no API key → unavailable, Octhera never called", async () => {
    asUser({ id: (await makeUser()).id });
    delete process.env.OCTHERA_API_KEY;
    expect((await open("octhera:mines-x")).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("legacy catalog (GAME_CATALOG=legacy): OCTHERA_PAGE=off → unavailable, Octhera never called", async () => {
    process.env.GAME_CATALOG = "legacy";
    asUser({ id: (await makeUser()).id });
    process.env.OCTHERA_PAGE = "off";
    expect((await open("octhera:mines-x")).status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Octhera refusing the launch → friendly 'unavailable'", async () => {
    asUser({ id: (await makeUser()).id });
    catalog();
    reply({ code: 403, status: "fail", message: "missing Wallet URL" }, 403);
    const { status, body } = await json<{ unavailable: boolean }>(await open("octhera:mines-x"));
    expect(status).toBe(502);
    expect(body.unavailable).toBe(true);
  });

  test("anonymous → 401", async () => {
    asAnon();
    expect((await open("octhera:mines-x")).status).toBe(401);
  });
});

describe("one player, start to finish (launch → bet → win → refresh)", () => {
  test("Octhera plays on the player's real VinnaBet balance, and nothing else moves", async () => {
    const { GET: balanceRoute } = await import("@/app/api/user/balance/route");
    const player = await makeUser({ balance: 100, depositBalance: 100 });
    const bystander = await makeUser({ balance: 100 });
    asUser({ id: player.id });
    const shown = async () => Number((await json<{ balance: string }>(await balanceRoute())).body.balance);

    // 1. Starting balance, as the site shows it.
    expect(await shown()).toBe(100);

    // 2. Open a game: Octhera gets the player's own id and that same balance.
    reply({ status: "ok", total: 1, games: [{ gameUid: "mines-x", name: "Mines X", provider: "P", providerName: "P", type: "Crash" }] });
    reply({ status: "ok", launchUrl: "https://api.octhera.org/play?token=1" });
    await gamesLaunch(req("POST", "/api/games/launch", { body: { game_uid: "octhera:mines-x" } }));
    const launch = JSON.parse(fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/players/launch"))![1].body);
    expect(launch).toMatchObject({ playerId: player.id, balance: 100 });

    // 3–4. A 2.50 bet comes off the real balance; Octhera is told the new one.
    const bet = await debit(player.id, { txnId: "seq-bet", betAmount: 2.5, gameRound: "seq-r" });
    expect(bet.body).toEqual({ status: "ok", balance: 97.5 });
    expect(await shown()).toBe(97.5);

    // 5. It is in the player's transaction history.
    const betRow = await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:debit:seq-bet" } });
    expect(betRow).toMatchObject({ userId: player.id, type: "BET", status: "COMPLETED" });
    expect([Number(betRow.amount), Number(betRow.balanceBefore), Number(betRow.balanceAfter)]).toEqual([2.5, 100, 97.5]);

    // 6. The win credits the real balance.
    const win = await credit(player.id, { txnId: "seq-win", winAmount: 6, gameRound: "seq-r" });
    expect(win.body).toEqual({ status: "ok", balance: 103.5 });
    const winRow = await prisma.transaction.findUniqueOrThrow({ where: { reference: "oc:credit:seq-win" } });
    expect(winRow).toMatchObject({ userId: player.id, type: "WIN", status: "COMPLETED" });

    // Octhera retrying either call changes nothing.
    expect((await debit(player.id, { txnId: "seq-bet", betAmount: 2.5, gameRound: "seq-r" })).body).toEqual(bet.body);
    expect((await credit(player.id, { txnId: "seq-win", winAmount: 6, gameRound: "seq-r" })).body).toEqual(win.body);

    // 7–8. A refresh shows what Octhera was last told.
    expect(await shown()).toBe(103.5);
    expect(await balanceOf(player.id)).toBe(win.body.balance);

    // 9. No other balance moved, and there is no second wallet: the only
    // Octhera rows are this player's call log.
    expect(await balanceOf(bystander.id)).toBe(100);
    expect(await prisma.transaction.count({ where: { userId: player.id } })).toBe(2);
    const logged = await prisma.octheraWalletTxn.findMany({ select: { playerId: true, applied: true } });
    expect(logged).toEqual([{ playerId: player.id, applied: true }, { playerId: player.id, applied: true }]);
  });

  test("every wallet call leaves one log line saying what we answered", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const p = await makeUser({ balance: 5 });
      await debit(p.id, { txnId: "log-1", betAmount: 2 });
      await debit(p.id, { txnId: "log-2", betAmount: 50 });
      await debit(p.id, { currency: "USD" });
      await send(call(p.id), { signature: "v1=deadbeef" });
      const lines = info.mock.calls.map((c) => String(c[0]));
      expect(lines[0]).toBe(`[octhera-wallet] debit/bet txn=log-1 player=${p.id} bet=2 win=0 → ok balance=3`);
      expect(lines[1]).toContain("txn=log-2");
      expect(lines[1]).toContain("→ INSUFFICIENT_FUNDS balance=3");
      expect(lines[2]).toContain("→ INVALID_REQUEST (currency USD, this site uses ETB");
      expect(lines[3]).toBe("[octhera-wallet] call → INVALID_SIGNATURE (signature doesn't match OCTHERA_WALLET_SECRET)");
    } finally {
      info.mockRestore();
    }
  });
});
