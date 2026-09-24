/**
 * Simulate a Gregmorn writeBet callback against a LOCAL dev server — exercises
 * the real signed-callback pipeline (balance debit, ticket attach, slip info
 * capture) without real money or a real provider session.
 *
 * Demo mode can't do this: demo:"1" launches send NO wallet callbacks.
 *
 * Usage:
 *   node scripts/simulate-gregmorn-bet.mjs --user +251911111111 --bet 20
 *   node scripts/simulate-gregmorn-bet.mjs --user <id> --bet 20 --win 62.85
 *   node scripts/simulate-gregmorn-bet.mjs --user ... --bet 20 --url http://localhost:3000
 *
 * Needs DATABASE_URL + GREGMORN_SECRET_KEY (read from .env automatically).
 * The user must have enough balance and, for ticket attach, an OPEN ticket.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

// ── tiny .env loader (no dotenv dep) ─────────────────────────────────────────
for (const f of [".env", ".env.local"]) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, [])
);

const USER = args.user;
const BET = Number(args.bet ?? 20);
const WIN = Number(args.win ?? 0);
const BASE = args.url ?? "http://localhost:3000";
const SECRET = process.env.GREGMORN_SECRET_KEY;

if (!USER || !SECRET || !process.env.DATABASE_URL) {
  console.error("Need --user <phone|id>, plus DATABASE_URL and GREGMORN_SECRET_KEY in .env");
  process.exit(1);
}

const prisma = new PrismaClient();

const user = await prisma.user.findFirst({
  where: { OR: [{ id: USER }, { phone: USER }] },
  select: { id: true, phone: true, role: true, balance: true },
});
if (!user) { console.error("User not found:", USER); process.exit(1); }
console.log(`User: ${user.phone} (${user.role}) balance=${user.balance}`);

// The callback requires a GameSession row matching sessionid + userId.
const session = await prisma.gameSession.create({
  data: {
    sessionId: `sim-${Date.now()}`,
    userId: user.id,
    gameId: "nova:sports-betby:sports",
  },
});

// BetBy-flavoured slip — mirrors the real printout shape (matches/odds/stake).
const info = {
  ticketId: "34699",
  type: "Combo",
  selections: [
    { match: "Netherlands - Germany", market: "1x2", pick: "Netherlands", odds: 2.54 },
    { match: "Norway - Denmark", market: "1x2", pick: "Denmark", odds: 4.3 },
    { match: "Serbia - Greece", market: "1x2", pick: "Serbia", odds: 2.74 },
  ],
  totalOdds: 31.423,
};

const payload = {
  cmd: "writeBet",
  login: user.id,
  sessionid: session.sessionId,
  transactionId: `sim-${Date.now()}`,
  roundId: `round-${Date.now()}`,
  bet: BET,
  win: WIN,
  round_finished: WIN > 0,
  gameId: "nova:sports-betby:sports",
  info,
};

const rawBody = JSON.stringify(payload);
const signature = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");

const res = await fetch(`${BASE}/api/provider/gregmorn/callback`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Signature": signature },
  body: rawBody,
});
console.log(res.status, await res.text());

await prisma.$disconnect();
