import { Prisma, type PrismaClient } from "@prisma/client";
import { Ledger } from "../../src/ledger/ledger";
import { GameWallet, type WalletCall } from "../../src/providers/gameWallet";
import { Hierarchy } from "../../src/users/hierarchy";
import { Players } from "../../src/users/players";
import { PHONE_KEY_PAIR } from "../keys";
import { testPrisma } from "./testDb";

jest.setTimeout(120_000);

let db: PrismaClient;
let ledger: Ledger;
let hierarchy: Hierarchy;
let players: Players;
let wallet: GameWallet;

beforeAll(() => {
  db = testPrisma();
  ledger = new Ledger(db);
  hierarchy = new Hierarchy(db, ledger);
  players = new Players(db, ledger, PHONE_KEY_PAIR);
  wallet = new GameWallet(db, ledger);
});
afterAll(async () => {
  expect(await ledger.checkInvariants()).toMatchObject({
    sumOfBalances: 0n,
    negativeViolations: [],
    ok: true,
  });
  expect(await ledger.reconcile()).toEqual([]);
  await db.$disconnect();
});

let n = 0;
let ph = 0;
let txn = 0;
const tid = () => `t${process.pid}-${++txn}`;

async function acc(type: "AGENT_CASH_POSITION" | "PLAYER_WALLET", id: bigint) {
  return (
    await ledger.openAccount({
      type,
      ownerKind: type === "PLAYER_WALLET" ? "player" : "agent",
      ownerId: id.toString(),
    })
  ).id;
}
const bal = async (type: "AGENT_CASH_POSITION" | "PLAYER_WALLET", id: bigint) =>
  ledger.getBalance(await acc(type, id));

/** Agent + player with `fund` santim deposited (agent cash → wallet, as a confirmed deposit does). */
async function setup(fund = 10_000n) {
  n += 1;
  const agent = await hierarchy.createAgent({ slug: `gw-${process.pid}-${n}`, displayName: `G${n}` });
  const player = await players.register({
    phone: `+25197${String(1_000_000 + ++ph).slice(-7)}`,
    referralSlug: agent.slug,
  });
  if (fund > 0n) {
    await ledger.post({
      idempotencyKey: `gw-fund-${player.id}`,
      reason: "deposit",
      entries: [
        {
          debitAccountId: await acc("AGENT_CASH_POSITION", agent.id),
          creditAccountId: await acc("PLAYER_WALLET", player.id),
          amount: fund,
        },
      ],
    });
  }
  const call = (type: WalletCall["type"], o: Partial<WalletCall> = {}): WalletCall => ({
    provider: "octhera",
    type,
    txnId: tid(),
    playerId: player.id,
    bet: 0n,
    win: 0n,
    action: type === "debit" ? "bet" : type === "credit" ? "win" : null,
    gameUid: "g1",
    gameRound: null,
    payload: { test: true },
    ...o,
  });
  return { agent, player, call };
}

describe("plan 07 §6 worked example", () => {
  it("matches the table step by step", async () => {
    const { agent, player, call } = await setup(10_000n);
    const cash0 = await bal("AGENT_CASH_POSITION", agent.id); // −10,000 after the deposit
    expect(await bal("PLAYER_WALLET", player.id)).toBe(10_000n);

    // 1. Bet 20 ETB on R1: wallet 8,000, agent +2,000. Bet open, with agent A.
    const r1 = await wallet.handle(call("debit", { bet: 2_000n, gameRound: "R1" }));
    expect(r1).toEqual({ ok: true, balance: 8_000n });
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cash0 + 2_000n);
    expect(await db.bet.findFirst({ where: { playerId: player.id, gameRound: "R1" } })).toMatchObject({
      status: "open",
      stake: 2_000n,
      agentId: agent.id,
    });

    // 2. Win 50 ETB on R1: wallet 13,000, agent −5,000. Bet settled.
    const win = call("credit", { win: 5_000n, gameRound: "R1" });
    expect(await wallet.handle(win)).toEqual({ ok: true, balance: 13_000n });
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cash0 - 3_000n);
    expect(await db.bet.findFirst({ where: { playerId: player.id, gameRound: "R1" } })).toMatchObject({
      status: "settled",
      stake: 2_000n,
      win: 5_000n,
    });

    // 3. Bet 30 ETB on R2, rolled back: wallet back to 13,000.
    const b2 = call("debit", { bet: 3_000n, gameRound: "R2" });
    expect(await wallet.handle(b2)).toEqual({ ok: true, balance: 10_000n });
    expect(await wallet.handle(call("rollback", { txnId: b2.txnId }))).toEqual({
      ok: true,
      balance: 13_000n,
    });
    expect((await db.bet.findFirstOrThrow({ where: { debitTxnId: b2.txnId } })).status).toBe("rolled_back");

    // 4. The win retried: replayed, nothing moves.
    expect(await wallet.handle(win)).toEqual({ ok: true, balance: 13_000n });
    expect(
      await db.ledgerTransaction.count({ where: { idempotencyKey: `octhera:credit:${win.txnId}` } }),
    ).toBe(1);
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cash0 - 3_000n);

    // 5. P moves to agent B: new bets go to B, the open round with A still pays from A.
    const b3 = call("debit", { bet: 1_000n, gameRound: "R3" }); // placed with A
    await wallet.handle(b3);
    const B = await hierarchy.createAgent({ slug: `gw-b-${process.pid}-${n}`, displayName: "B" });
    await db.player.update({ where: { id: player.id }, data: { agentId: B.id } });
    await wallet.handle(call("debit", { bet: 500n, gameRound: "R4" }));
    expect((await db.bet.findFirstOrThrow({ where: { playerId: player.id, gameRound: "R4" } })).agentId).toBe(
      B.id,
    );
    const cashBeforeWin = await bal("AGENT_CASH_POSITION", agent.id);
    await wallet.handle(call("credit", { win: 1_500n, gameRound: "R3" }));
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cashBeforeWin - 1_500n); // A pays its own bet's win
    expect((await db.bet.findFirstOrThrow({ where: { playerId: player.id, gameRound: "R1" } })).agentId).toBe(
      agent.id,
    );
  });
});

describe("debits", () => {
  it("bet_win settles at once with the net amount; an even bet_win posts nothing", async () => {
    const { player, call } = await setup(10_000n);
    expect(await wallet.handle(call("debit", { action: "bet_win", bet: 1_000n, win: 2_500n }))).toEqual({
      ok: true,
      balance: 11_500n,
    });
    expect(await wallet.handle(call("debit", { action: "bet_win", bet: 2_000n, win: 500n }))).toEqual({
      ok: true,
      balance: 10_000n,
    });
    const even = call("debit", { action: "bet_win", bet: 700n, win: 700n });
    expect(await wallet.handle(even)).toEqual({ ok: true, balance: 10_000n });
    expect(
      (await db.providerCall.findFirstOrThrow({ where: { txnId: even.txnId } })).ledgerTransactionId,
    ).toBeNull();
    const bets = await db.bet.findMany({ where: { playerId: player.id }, orderBy: { id: "asc" } });
    expect(bets.map((b) => [b.status, b.stake, b.win])).toEqual([
      ["settled", 1_000n, 2_500n],
      ["settled", 2_000n, 500n],
      ["settled", 700n, 700n],
    ]);
  });

  it("refuses too little money and a blocked player (stored and replayed); an unknown player isn't stored", async () => {
    const { player, call } = await setup(1_000n);
    const big = call("debit", { bet: 1_001n });
    expect(await wallet.handle(big)).toEqual({ ok: false, code: "INSUFFICIENT_FUNDS", balance: 1_000n });
    expect(await wallet.handle(big)).toEqual({ ok: false, code: "INSUFFICIENT_FUNDS", balance: 1_000n });
    await db.player.update({ where: { id: player.id }, data: { status: "self_excluded" } });
    expect(await wallet.handle(call("debit", { bet: 10n }))).toMatchObject({
      ok: false,
      code: "PLAYER_BLOCKED",
    });
    const ghost = call("debit", { bet: 10n, playerId: 999_999_999n });
    expect(await wallet.handle(ghost)).toEqual({ ok: false, code: "PLAYER_NOT_FOUND" });
    expect(await wallet.handle(call("debit", { bet: 10n, playerId: null }))).toEqual({
      ok: false,
      code: "PLAYER_NOT_FOUND",
    });
    expect(await db.providerCall.count({ where: { txnId: ghost.txnId } })).toBe(0);
  });

  it("20 parallel bets of 10 ETB from 100 ETB: exactly 10 taken, never overdrawn", async () => {
    const { player, call } = await setup(10_000n);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => wallet.handle(call("debit", { bet: 1_000n }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && r.code === "INSUFFICIENT_FUNDS")).toHaveLength(10);
    expect(await bal("PLAYER_WALLET", player.id)).toBe(0n);
  });

  it("20 parallel retries of one bet: one posting, identical answers", async () => {
    const { player, call } = await setup(10_000n);
    const c = call("debit", { bet: 300n });
    const results = await Promise.all(Array.from({ length: 20 }, () => wallet.handle(c)));
    expect(
      new Set(results.map((r) => JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? String(v) : v)))).size,
    ).toBe(1);
    expect(await db.bet.count({ where: { debitTxnId: c.txnId } })).toBe(1);
    expect(await bal("PLAYER_WALLET", player.id)).toBe(9_700n);
  });
});

describe("credits", () => {
  it("a win with no bet behind it is refused, kept, and paid once a late bet backs it", async () => {
    const { agent, call } = await setup(500n);
    const w = call("credit", { win: 3_000n, gameRound: "R-late" });
    expect(await wallet.handle(w)).toEqual({ ok: false, code: "TXN_NOT_FOUND", balance: 500n });
    expect(await wallet.handle(w)).toEqual({ ok: false, code: "TXN_NOT_FOUND", balance: 500n }); // re-checked, still one row
    expect(await db.providerCall.count({ where: { txnId: w.txnId } })).toBe(1);

    // Octhera sends the stake as a late bet; we refuse it (too little money)…
    expect(
      await wallet.handle(call("debit", { txnId: `${w.txnId}:stake`, bet: 1_000n, gameRound: "R-late" })),
    ).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    // …then the retried win (net of the stake) is paid, from the player's agent.
    const cash = await bal("AGENT_CASH_POSITION", agent.id);
    expect(await wallet.handle({ ...w, win: 2_000n })).toEqual({ ok: true, balance: 2_500n });
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cash - 2_000n);
    expect(await db.bet.findFirstOrThrow({ where: { debitTxnId: `credit:${w.txnId}` } })).toMatchObject({
      stake: 0n,
      win: 2_000n,
      status: "settled",
    });
    expect(
      (await db.providerCall.findFirstOrThrow({ where: { txnId: w.txnId, type: "credit" } })).applied,
    ).toBe(true);
    expect(await wallet.handle({ ...w, win: 2_000n })).toEqual({ ok: true, balance: 2_500n }); // replay
  });

  it("a late bet that was taken doesn't back a credit by itself; a win without a round isn't backed", async () => {
    const { call } = await setup(10_000n);
    const w = call("credit", { win: 100n, gameRound: null });
    expect(await wallet.handle(w)).toMatchObject({ code: "TXN_NOT_FOUND" });
    const w2 = call("credit", { win: 100n });
    await wallet.handle(call("debit", { txnId: `${w2.txnId}:stake`, bet: 100n })); // applied, no round
    expect(await wallet.handle(w2)).toMatchObject({ code: "TXN_NOT_FOUND" });
  });

  it("a zero win settles the round without moving money; refunds and blocked players are paid", async () => {
    const { player, call } = await setup(10_000n);
    await wallet.handle(call("debit", { bet: 1_000n, gameRound: "Z" }));
    const zero = call("credit", { win: 0n, gameRound: "Z" });
    expect(await wallet.handle(zero)).toEqual({ ok: true, balance: 9_000n });
    expect((await db.bet.findFirstOrThrow({ where: { gameRound: "Z", playerId: player.id } })).status).toBe(
      "settled",
    );
    expect(
      (await db.providerCall.findFirstOrThrow({ where: { txnId: zero.txnId } })).ledgerTransactionId,
    ).toBeNull();

    await wallet.handle(call("debit", { bet: 1_000n, gameRound: "RF" }));
    await db.player.update({ where: { id: player.id }, data: { status: "frozen" } });
    expect(await wallet.handle(call("credit", { action: "refund", win: 1_000n, gameRound: "RF" }))).toEqual({
      ok: true,
      balance: 9_000n,
    });
    expect(await wallet.handle(call("credit", { win: 1n, playerId: null }))).toEqual({
      ok: false,
      code: "PLAYER_NOT_FOUND",
    });
  });
});

describe("more credit and rollback paths", () => {
  it("a win in a round with two bets goes on the last one and settles both", async () => {
    const { player, call } = await setup(10_000n);
    await wallet.handle(call("debit", { bet: 100n, gameRound: "TWO" }));
    await wallet.handle(call("debit", { bet: 200n, gameRound: "TWO" }));
    await wallet.handle(call("credit", { win: 900n, gameRound: "TWO" }));
    const bets = await db.bet.findMany({
      where: { playerId: player.id, gameRound: "TWO" },
      orderBy: { id: "asc" },
    });
    expect(bets.map((b) => [b.status, b.win])).toEqual([
      ["settled", 0n],
      ["settled", 900n],
    ]);
  });

  it("a late bet only backs the same player's win, and a backed win needs no round id", async () => {
    const a = await setup(100n);
    const b = await setup(100n);
    const w = a.call("credit", { win: 50n, gameRound: null });
    await wallet.handle(b.call("debit", { txnId: `${w.txnId}:stake`, bet: 1_000n })); // refused, but it's B's
    expect(await wallet.handle(w)).toMatchObject({ code: "TXN_NOT_FOUND" });
    const w2 = a.call("credit", { win: 50n, gameRound: null });
    await wallet.handle(a.call("debit", { txnId: `${w2.txnId}:stake`, bet: 1_000n })); // A's, refused for funds
    expect(await wallet.handle(w2)).toEqual({ ok: true, balance: 150n });
  });

  it("a late bet refused for a blocked account backs the win; one refused as rolled back doesn't", async () => {
    const { player, call } = await setup(10_000n);
    const w = call("credit", { win: 70n });
    await db.player.update({ where: { id: player.id }, data: { status: "frozen" } });
    await wallet.handle(call("debit", { txnId: `${w.txnId}:stake`, bet: 10n })); // PLAYER_BLOCKED
    expect(await wallet.handle(w)).toEqual({ ok: true, balance: 10_070n });
    await db.player.update({ where: { id: player.id }, data: { status: "active" } });
    const w2 = call("credit", { win: 70n });
    await wallet.handle(call("rollback", { txnId: `${w2.txnId}:stake` }));
    await wallet.handle(call("debit", { txnId: `${w2.txnId}:stake`, bet: 10n })); // TXN_ROLLED_BACK
    expect(await wallet.handle(w2)).toMatchObject({ code: "TXN_NOT_FOUND" });
  });

  it("rolling back a bet_win with enough in the wallet reverses it in full", async () => {
    const { call } = await setup(10_000n);
    const bw = call("debit", { action: "bet_win", bet: 1_000n, win: 3_000n });
    expect(await wallet.handle(bw)).toEqual({ ok: true, balance: 12_000n });
    expect(await wallet.handle(call("rollback", { txnId: bw.txnId }))).toEqual({
      ok: true,
      balance: 10_000n,
    });
  });
});

describe("rollbacks", () => {
  it("a rollback before its debit leaves a marker; the late debit is refused", async () => {
    const { call } = await setup(10_000n);
    const id = tid();
    expect(await wallet.handle(call("rollback", { txnId: id }))).toEqual({ ok: true, balance: 10_000n });
    expect(await wallet.handle(call("debit", { txnId: id, bet: 500n }))).toEqual({
      ok: false,
      code: "TXN_ROLLED_BACK",
      balance: 10_000n,
    });
    expect(await wallet.handle(call("rollback", { txnId: id }))).toEqual({ ok: true, balance: 10_000n }); // replay
  });

  it("rolling back a refused debit, another player's debit, or for an unknown player moves nothing", async () => {
    const a = await setup(100n);
    const b = await setup(10_000n);
    const refused = a.call("debit", { bet: 5_000n });
    await wallet.handle(refused);
    expect(await wallet.handle(a.call("rollback", { txnId: refused.txnId }))).toEqual({
      ok: true,
      balance: 100n,
    });
    const theirs = b.call("debit", { bet: 1_000n });
    await wallet.handle(theirs);
    expect(await wallet.handle(a.call("rollback", { txnId: theirs.txnId }))).toEqual({
      ok: true,
      balance: 100n,
    });
    expect(await bal("PLAYER_WALLET", b.player.id)).toBe(9_000n);
    expect(await wallet.handle(a.call("rollback", { playerId: null }))).toEqual({ ok: true });
    // An even bet_win (no posting) rolls back to just a status change.
    const even = b.call("debit", { action: "bet_win", bet: 10n, win: 10n });
    await wallet.handle(even);
    expect(await wallet.handle(b.call("rollback", { txnId: even.txnId }))).toEqual({
      ok: true,
      balance: 9_000n,
    });
  });

  it("rolling back a win the player already spent takes what's there and records the shortfall", async () => {
    const { agent, call } = await setup(1_000n);
    const bw = call("debit", { action: "bet_win", bet: 1_000n, win: 5_000n }); // wallet 5,000
    await wallet.handle(bw);
    await wallet.handle(call("debit", { bet: 4_500n })); // spends: wallet 500
    const cash = await bal("AGENT_CASH_POSITION", agent.id);
    const rb = call("rollback", { txnId: bw.txnId });
    expect(await wallet.handle(rb)).toEqual({ ok: true, balance: 0n });
    expect(await bal("AGENT_CASH_POSITION", agent.id)).toBe(cash + 500n);
    const row = await db.providerCall.findFirstOrThrow({ where: { txnId: rb.txnId, type: "rollback" } });
    expect(row.payload).toMatchObject({ shortfallSantim: "3500" });
    // With nothing left in the wallet, a further rollback of a bet_win posts nothing.
    const bw2 = call("debit", { action: "bet_win", bet: 0n, win: 100n });
    await wallet.handle(bw2);
    await wallet.handle(call("debit", { bet: 100n }));
    expect(await wallet.handle(call("rollback", { txnId: bw2.txnId }))).toEqual({ ok: true, balance: 0n });
  });
});

describe("open bets and auto-settle (Q-35)", () => {
  it("counts open bets and settles old ones as lost", async () => {
    const { player, call } = await setup(10_000n);
    const c = call("debit", { bet: 100n });
    await wallet.handle(c);
    expect(await wallet.openBets(player.id)).toBe(1);
    expect(await wallet.autoSettle(24, new Date(Date.now() + 23 * 3_600_000))).toBe(0);
    expect(await wallet.autoSettle(24, new Date(Date.now() + 25 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect(await wallet.openBets(player.id)).toBe(0);
    expect(await db.bet.findFirstOrThrow({ where: { debitTxnId: c.txnId } })).toMatchObject({
      status: "settled",
      win: 0n,
    });
  });
});

describe("database guards", () => {
  it("bets only move forward and keep their player, agent and stake; calls are immutable", async () => {
    const { call } = await setup(10_000n);
    const c = call("debit", { bet: 100n });
    await wallet.handle(c);
    const bet = await db.bet.findFirstOrThrow({ where: { debitTxnId: c.txnId } });
    await expect(db.bet.update({ where: { id: bet.id }, data: { stake: 1n } })).rejects.toThrow(/immutable/);
    await db.bet.update({ where: { id: bet.id }, data: { status: "settled", win: 50n } });
    await expect(db.bet.update({ where: { id: bet.id }, data: { status: "open" } })).rejects.toThrow(
      /can't go from settled to open/,
    );
    await expect(db.bet.update({ where: { id: bet.id }, data: { win: 10n } })).rejects.toThrow(/can't go/);
    await expect(db.bet.delete({ where: { id: bet.id } })).rejects.toThrow(/never deleted/);
    const row = await db.providerCall.findFirstOrThrow({ where: { txnId: c.txnId } });
    await expect(db.providerCall.update({ where: { id: row.id }, data: { applied: false } })).rejects.toThrow(
      /immutable/,
    );
    await expect(db.providerCall.delete({ where: { id: row.id } })).rejects.toThrow(/immutable/);
    await db.bet.update({ where: { id: bet.id }, data: { status: "rolled_back" } });
    await expect(db.bet.update({ where: { id: bet.id }, data: { status: "settled" } })).rejects.toThrow(
      /can't go from rolled_back/,
    );
  });
});

describe("unexpected errors", () => {
  const p2002 = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" });
  const fake = (err: Error, prior: unknown) =>
    new GameWallet(
      {
        $transaction: () => Promise.reject(err),
        providerCall: { findUnique: async () => prior },
      } as unknown as PrismaClient,
      ledger,
    );
  const c: WalletCall = {
    provider: "octhera",
    type: "rollback",
    txnId: "x",
    playerId: null,
    bet: 0n,
    win: 0n,
    action: null,
    gameUid: null,
    gameRound: null,
    payload: {},
  };

  it("a duplicate that raced replays the winner's answer; anything else is rethrown", async () => {
    expect(await fake(p2002(), { response: { ok: true, balance: "250" } }).handle(c)).toEqual({
      ok: true,
      balance: 250n,
    });
    expect(await fake(p2002(), { response: { ok: false, code: "TXN_NOT_FOUND" } }).handle(c)).toEqual({
      ok: false,
      code: "TXN_NOT_FOUND",
    });
    await expect(fake(p2002(), null).handle(c)).rejects.toThrow("dup");
    await expect(fake(new Error("db down"), null).handle(c)).rejects.toThrow("db down");
  });

  it("a non-funds ledger error during a bet is rethrown", async () => {
    const { call } = await setup(10_000n);
    const broken = new GameWallet(db, {
      ...ledger,
      openAccount: ledger.openAccount.bind(ledger),
      postInTransaction: () => Promise.reject(new Error("ledger down")),
    } as unknown as Ledger);
    await expect(broken.handle(call("debit", { bet: 10n }))).rejects.toThrow("ledger down");
  });
});
