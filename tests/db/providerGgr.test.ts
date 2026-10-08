import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as overview } from "@/app/api/admin/provider-ggr/route";
import { GET as details } from "@/app/api/admin/provider-ggr/[key]/route";
import { POST as setRate } from "@/app/api/admin/provider-ggr/rates/route";
import { addDays, dayIn } from "@/lib/providerGgrCore";
import { createAdminSession, ADMIN_COOKIE } from "@/lib/adminSession";
import { makeUser, truncateAll } from "../factories";
import { adminAuth } from "../helpers/auth";
import { json, params, req } from "../helpers/req";

/*
 * Provider GGR from real ledger rows, written exactly the way each wallet
 * callback writes them: Silent (serial refs, bet_amount/win_amount), Gregmorn
 * (gm:<id> + gm:<id>:rollback) and Octhera (oc:debit|credit|rollback).
 */

const TZ = "Africa/Addis_Ababa"; // the default REPORT_TIMEZONE, UTC+3
const today = () => dayIn(TZ);
/** A UTC instant at `hh`:00 local time on `day`. */
const at = (day: string, hh = 12) => new Date(`${day}T${String(hh - 3).padStart(2, "0")}:00:00Z`);

const SILENT_GAME = "f0980130e62b9465a069bf337d4ace74"; // game_list/18peaches_en.json
const SPORTSBOOK = "8a704858d5deb4af1ddc722092ac7614"; // game_list/betby.json
const GREG_GAME = "black:egt:169"; // game_list-gregmorn/egt.json

let userId = "";
let n = 0;
async function row(reference: string, type: "BET" | "WIN" | "REFUND", metadata: object, createdAt: Date) {
  await prisma.transaction.create({
    data: { userId, type, status: "COMPLETED", amount: 0, balanceBefore: 0, balanceAfter: 0, reference, metadata, createdAt },
  });
}
const silent = (round: string, bet: number, win: number, when: Date, game = SILENT_GAME, currency = "ETB") =>
  row(`silent-${++n}`, win > bet ? "WIN" : "BET",
    { serial_number: `s${n}`, bet_amount: String(bet), win_amount: String(win), game_uid: game, game_round: round, currency }, when);
const greg = (id: string, bet: number, win: number, when: Date, finished = true) =>
  row(`gm:${id}`, win > bet ? "WIN" : "BET", { bet, win, gameId: GREG_GAME, roundId: `r-${id}`, round_finished: finished }, when);
const gregRollback = (id: string, when: Date) => row(`gm:${id}:rollback`, "REFUND", { rolledBackTransaction: `gm:${id}` }, when);
const ocDebit = (id: string, uid: string, round: string, bet: number, win: number, when: Date, action = "bet") =>
  row(`oc:debit:${id}`, win > bet ? "WIN" : "BET",
    { type: "debit", txnId: id, betAmount: bet, winAmount: win, action, gameUid: uid, gameRound: round, currency: "ETB", provider: "octhera" }, when);
const ocCredit = (id: string, uid: string, round: string, win: number, when: Date, action = "win", echoedBet = 0) =>
  row(`oc:credit:${id}`, action === "refund" ? "REFUND" : "WIN",
    { type: "credit", txnId: id, betAmount: echoedBet, winAmount: win, action, gameUid: uid, gameRound: round, currency: "ETB" }, when);
const ocRollback = (id: string, when: Date) => row(`oc:rollback:${id}`, "REFUND", { type: "rollback", txnId: id }, when);

type Line = { providerKey: string; currency: string; totalBet: number; totalWin: number; ggr: number; fee: number; remaining: number; unsettledBet: number; unsettledRounds: number; voidedBet: number; voidedRounds: number; rounds: number };
async function lines(period = "month", extra = "") {
  const auth = await adminAuth();
  const r = await json<{ currencies: { currency: string; lines: Line[] }[]; canEdit: boolean; error?: string }>(
    await overview(req("GET", `/api/admin/provider-ggr?period=${period}${extra}`, auth)),
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { all: r.body.currencies.flatMap((c) => c.lines), body: r.body };
}
const find = (ls: Line[], key: string, currency = "ETB") => ls.find((l) => l.providerKey === key && l.currency === currency);

async function rate(providerKey: string, ratePct: number, negativePolicy: string, effectiveFrom: string, note?: string, as?: string) {
  const auth = await adminAuth();
  if (as) auth.cookies[ADMIN_COOKIE] = await createAdminSession(as);
  return json<{ error?: string }>(await setRate(req("POST", "/api/admin/provider-ggr/rates", {
    ...auth, body: { providerKey, ratePct, negativePolicy, effectiveFrom, ...(note ? { note } : {}) },
  })));
}

beforeAll(async () => {
  await truncateAll();
});

beforeEach(async () => {
  await prisma.transaction.deleteMany({});
  await prisma.providerFeeRate.deleteMany({});
  // The migration's seed (truncateAll wipes it): Silent API, 10% per round.
  await prisma.providerFeeRate.create({
    data: { id: "seed_silent_default", providerKey: "silent:*", ratePct: 10, negativePolicy: "per_round", effectiveFrom: new Date("2000-01-01"), changedBy: "migration" },
  });
  await prisma.catalogGame.deleteMany({});
  await prisma.catalogGame.create({
    data: { id: "c1", source: "octhera", externalId: "uid-prag", name: "Gates of Olympus", providerCode: "pragmatic", providerName: "Pragmatic Play", providerSlug: "pragmatic", rawType: "slot", section: "casino", category: "slots", img: "" },
  });
  userId = (await makeUser()).id;
});

describe("counting — each integration's ledger shape", () => {
  test("Silent: a round's stake and win callbacks fold into one round", async () => {
    const d = at(today(), 10);
    await silent("r1", 100, 0, d);
    await silent("r1", 0, 150, d);
    await silent("r2", 50, 0, d);
    await silent("r2", 0, 0, d); // close callback
    const l = find((await lines()).all, "silent:18peaches_en")!;
    expect(l).toMatchObject({ totalBet: 150, totalWin: 150, ggr: 0, rounds: 2, unsettledRounds: 0 });
  });

  test("Gregmorn: a rolled-back round is excluded and reported as voided", async () => {
    const d = at(today(), 10);
    await greg("1", 50, 0, d);
    await greg("2", 40, 0, d);
    await gregRollback("2", d);
    const l = find((await lines()).all, "gregmorn:egt")!;
    expect(l).toMatchObject({ totalBet: 50, totalWin: 0, ggr: 50, voidedBet: 40, voidedRounds: 1 });
  });

  test("Octhera: credit's echoed stake isn't recounted; rollback voids; refund nets to zero", async () => {
    const d = at(today(), 10);
    await ocDebit("d1", "uid-prag", "g1", 20, 0, d);
    await ocCredit("c1", "uid-prag", "g1", 30, d, "win", 20); // echoes betAmount 20
    await ocDebit("d2", "uid-prag", "g2", 10, 0, d);
    await ocRollback("d2", d);
    await ocDebit("d3", "uid-prag", "g3", 15, 0, d);
    await ocCredit("c3", "uid-prag", "g3", 15, d, "refund", 15);
    const l = find((await lines()).all, "octhera:pragmatic")!;
    expect(l).toMatchObject({ totalBet: 35, totalWin: 45, ggr: -10, voidedBet: 10, voidedRounds: 1, rounds: 2 });
  });

  test("unknown game → unattributed, never split across providers", async () => {
    await ocDebit("x1", "uid-nobody-knows", "gx", 70, 0, at(today(), 10), "bet_win");
    const ls = (await lines()).all;
    expect(find(ls, "octhera:unattributed")).toMatchObject({ totalBet: 70, ggr: 70 });
    expect(find(ls, "octhera:pragmatic")).toBeUndefined();
  });

  test("currencies stay separate", async () => {
    const d = at(today(), 10);
    await silent("e1", 100, 0, d, SILENT_GAME, "ETB");
    await silent("e1", 0, 0, d, SILENT_GAME, "ETB");
    await silent("u1", 10, 0, d, SILENT_GAME, "USD");
    await silent("u1", 0, 0, d, SILENT_GAME, "USD");
    const { all, body } = await lines();
    expect(body.currencies.map((c) => c.currency).sort()).toEqual(["ETB", "USD"]);
    expect(find(all, "silent:18peaches_en", "ETB")!.totalBet).toBe(100);
    expect(find(all, "silent:18peaches_en", "USD")!.totalBet).toBe(10);
  });

  test("an open sportsbook bet is unsettled, not GGR", async () => {
    await silent("sb1", 200, 0, at(addDays(today(), -3), 10), SPORTSBOOK);
    const l = find((await lines("custom", `&from=${addDays(today(), -5)}&to=${today()}`)).all, "silent:betby")!;
    expect(l).toMatchObject({ totalBet: 0, ggr: 0, unsettledBet: 200, unsettledRounds: 1 });
  });

  test("a casino round with no close event counts as settled after a day", async () => {
    await silent("old", 30, 0, at(addDays(today(), -2), 10));
    const l = find((await lines("custom", `&from=${addDays(today(), -5)}&to=${today()}`)).all, "silent:18peaches_en")!;
    expect(l).toMatchObject({ totalBet: 30, unsettledBet: 0 });
  });

  test("a round is dated by its start: a late win for an earlier bet isn't a stake-less win today", async () => {
    await silent("late", 100, 0, at(addDays(today(), -10), 10), SPORTSBOOK);
    await silent("late", 0, 400, at(today(), 9), SPORTSBOOK);
    const todayLine = find((await lines("today")).all, "silent:betby");
    expect(todayLine).toBeUndefined();
    const then = find((await lines("custom", `&from=${addDays(today(), -10)}&to=${addDays(today(), -10)}`)).all, "silent:betby")!;
    expect(then).toMatchObject({ totalBet: 100, totalWin: 400, ggr: -300 });
  });
});

describe("fees", () => {
  test("the example: 100,000 bet, 80,000 win, 8% → fee 1,600, remaining 18,400", async () => {
    await ocDebit("big", "uid-prag", "gb", 100000, 80000, at(today(), 10), "bet_win");
    expect((await rate("octhera:pragmatic", 8, "net_floor", today())).status).toBe(200);
    const l = find((await lines()).all, "octhera:pragmatic")!;
    expect(l).toMatchObject({ totalBet: 100000, totalWin: 80000, ggr: 20000, fee: 1600, remaining: 18400 });
  });

  test("negative GGR: shown as is; fee depends on the agreement", async () => {
    await ocDebit("neg", "uid-prag", "gn", 1000, 3000, at(today(), 10), "bet_win");
    await rate("octhera:pragmatic", 10, "net_floor", today());
    expect(find((await lines()).all, "octhera:pragmatic")).toMatchObject({ ggr: -2000, fee: 0, remaining: -2000 });
    await rate("octhera:pragmatic", 10, "net_credit", today());
    expect(find((await lines()).all, "octhera:pragmatic")).toMatchObject({ ggr: -2000, fee: -200, remaining: -1800 });
  });

  test("Silent's seeded agreement: 10% per house-won round, never netted", async () => {
    const d = at(today(), 10);
    await silent("w1", 10, 0, d); await silent("w1", 0, 0, d); // house +10
    await silent("w2", 10, 0, d); await silent("w2", 0, 50, d); // player +40
    const l = find((await lines()).all, "silent:18peaches_en")!;
    expect(l).toMatchObject({ ggr: -30, fee: 1, remaining: -31 });
  });

  test("a rate change doesn't recalculate earlier days", async () => {
    const yesterday = addDays(today(), -1);
    await ocDebit("y", "uid-prag", "gy", 1000, 0, at(yesterday, 10), "bet_win");
    await ocDebit("t", "uid-prag", "gt", 1000, 0, at(today(), 10), "bet_win");
    await rate("octhera:pragmatic", 8, "net_floor", yesterday, "agreement start");
    await rate("octhera:pragmatic", 12, "net_floor", today());

    expect(find((await lines("yesterday")).all, "octhera:pragmatic")!.fee).toBe(80);
    expect(find((await lines("today")).all, "octhera:pragmatic")!.fee).toBe(120);
    const both = find((await lines("custom", `&from=${yesterday}&to=${today()}`)).all, "octhera:pragmatic")!;
    expect(both.fee).toBe(200);
  });

  test("an integration-wide default applies unless a provider has its own", async () => {
    await ocDebit("a", "uid-prag", "ga", 1000, 0, at(today(), 10), "bet_win");
    await rate("octhera:*", 5, "net_floor", today());
    expect(find((await lines()).all, "octhera:pragmatic")!.fee).toBe(50);
    await rate("octhera:pragmatic", 7, "net_floor", today());
    expect(find((await lines()).all, "octhera:pragmatic")!.fee).toBe(70);
  });
});

describe("rates: validation, permissions, history", () => {
  test.each([[-1], [100.5], [8.123]])("rejects %s%%", async (pct) => {
    expect((await rate("octhera:pragmatic", pct, "net_floor", today())).status).toBe(400);
  });

  test("rejects an unknown policy or provider key", async () => {
    expect((await rate("octhera:pragmatic", 5, "whatever", today())).status).toBe(400);
    expect((await rate("not-a-key", 5, "net_floor", today())).status).toBe(400);
  });

  test("backdating requires a note", async () => {
    expect((await rate("octhera:pragmatic", 5, "net_floor", addDays(today(), -3))).status).toBe(400);
    expect((await rate("octhera:pragmatic", 5, "net_floor", addDays(today(), -3), "late contract")).status).toBe(200);
  });

  test("only admins on GGR_RATE_EDITORS may change rates", async () => {
    const prev = process.env.GGR_RATE_EDITORS;
    process.env.GGR_RATE_EDITORS = "finance";
    try {
      expect((await rate("octhera:pragmatic", 5, "net_floor", today(), undefined, "someone-else")).status).toBe(403);
      expect((await rate("octhera:pragmatic", 5, "net_floor", today(), undefined, "finance")).status).toBe(200);
      const row = await prisma.providerFeeRate.findFirstOrThrow({ where: { providerKey: "octhera:pragmatic" } });
      expect(row.changedBy).toBe("finance");
    } finally {
      if (prev === undefined) delete process.env.GGR_RATE_EDITORS; else process.env.GGR_RATE_EDITORS = prev;
    }
  });

  test("details: same range, rate history with who/when, breakdown by game and day", async () => {
    await ocDebit("dd", "uid-prag", "gd", 500, 100, at(today(), 10), "bet_win");
    await rate("octhera:pragmatic", 8, "net_floor", today(), "contract v2");
    const auth = await adminAuth();
    const r = await json<{
      providerName: string; currentRate: { ratePct: number; changedBy: string };
      rateHistory: { ratePct: number; note: string | null }[];
      currencies: { currency: string; totals: Line; byGame: { gameName: string; ggr: number }[]; byDay: { day: string; ggr: number; ratePct: number | null }[] }[];
    }>(await details(req("GET", `/api/admin/provider-ggr/octhera%3Apragmatic?period=today`, auth), params({ key: "octhera%3Apragmatic" })));
    expect(r.status).toBe(200);
    expect(r.body.providerName).toBe("Pragmatic Play");
    expect(r.body.currentRate).toMatchObject({ ratePct: 8, changedBy: process.env.ADMIN_USERNAME ?? "testadmin" });
    expect(r.body.rateHistory[0]).toMatchObject({ ratePct: 8, note: "contract v2" });
    const c = r.body.currencies[0];
    expect(c.totals).toMatchObject({ ggr: 400, fee: 32 });
    expect(c.byGame[0]).toMatchObject({ gameName: "Gates of Olympus", ggr: 400 });
    expect(c.byDay).toHaveLength(1);
    expect(c.byDay[0]).toMatchObject({ day: today(), ggr: 400, ratePct: 8 });
  });
});

describe("date filters", () => {
  test("today / yesterday / custom split on local (Addis) midnight", async () => {
    const y = addDays(today(), -1);
    // 23:30 local yesterday = 20:30Z; 00:30 local today = 21:30Z the day before in UTC.
    await ocDebit("late-y", "uid-prag", "ly", 10, 0, new Date(`${y}T20:30:00Z`), "bet_win");
    await ocDebit("early-t", "uid-prag", "et", 20, 0, new Date(`${y}T21:30:00Z`), "bet_win");
    expect(find((await lines("yesterday")).all, "octhera:pragmatic")!.totalBet).toBe(10);
    expect(find((await lines("today")).all, "octhera:pragmatic")!.totalBet).toBe(20);
    expect(find((await lines("custom", `&from=${y}&to=${today()}`)).all, "octhera:pragmatic")!.totalBet).toBe(30);
  });

  test("an invalid custom range is refused", async () => {
    const auth = await adminAuth();
    const r = await overview(req("GET", `/api/admin/provider-ggr?period=custom&from=2026-10-09&to=2026-10-01`, auth));
    expect(r.status).toBe(400);
  });
});
