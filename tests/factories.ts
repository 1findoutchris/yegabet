// Relative, not "@/": Playwright's loader does not resolve the tsconfig path
// alias (there is no baseUrl), and this module is imported by the E2E
// globalSetup as well as the Vitest suite.
import { prisma } from "../src/lib/prisma";
import { DEFAULT_REWARD_CONFIG } from "../src/lib/rewardConfigCore";

/*
 * Fixture builders for the DB suite. Plain async functions — no builder DSL, no
 * fixture framework. Everything returns the created row so tests can chain.
 *
 * Two rules that matter:
 *  - unique defaults come off a module counter, so tests inside a file never
 *    collide and don't need cleaning up between each other
 *  - the bcrypt hash is a CONSTANT. The app hashes at cost 12 (~200ms); doing
 *    that per fixture user would dominate the suite's runtime.
 */

/**
 * bcrypt hash of TEST_PASSWORD at cost 12, precomputed and verified.
 * tests/unit/factories.test.ts asserts it still matches — a stale hash here
 * would fail every login test with a misleading "wrong password".
 */
export const TEST_PASSWORD = "test1234";
export const TEST_PASSWORD_HASH =
  "$2b$12$aeFWH3SHJlEo.iOVV83EkuBwMYM6Vbbx.v10JhzrCL6l.nrLhTXAO";

let counter = 0;
/** Unique across parallel-ish runs and across files in one run. */
function nextId(): string {
  counter += 1;
  return `${process.pid % 1000}${String(counter).padStart(5, "0")}`;
}

export async function makeUser(overrides: {
  phone?: string;
  username?: string;
  name?: string;
  balance?: number;
  depositBalance?: number;
  bonusBalance?: number;
  loyaltyPoints?: number;
  pointsBalance?: number;
  spinCredits?: number;
  isActive?: boolean;
  referredById?: string;
  referralCode?: string;
} = {}) {
  const n = nextId();
  return prisma.user.create({
    data: {
      phone: overrides.phone ?? `+2519${n.padStart(8, "0").slice(-8)}`,
      username: overrides.username ?? `user_${n}`,
      name: overrides.name ?? "Test User",
      passwordHash: TEST_PASSWORD_HASH,
      balance: overrides.balance ?? 0,
      depositBalance: overrides.depositBalance ?? 0,
      bonusBalance: overrides.bonusBalance ?? 0,
      loyaltyPoints: overrides.loyaltyPoints ?? 0,
      pointsBalance: overrides.pointsBalance ?? 0,
      spinCredits: overrides.spinCredits ?? 0,
      isActive: overrides.isActive ?? true,
      // Last 6 chars, not the first — `R${n}`.slice(0,6) truncated the varying
      // tail and collided on the unique index for sequential ids.
      referralCode: overrides.referralCode ?? `R${n}`.slice(-6).toUpperCase(),
      ...(overrides.referredById ? { referredById: overrides.referredById } : {}),
    },
  });
}

export async function makeWithdrawalAgent(overrides: {
  username?: string;
  methods?: string[];
  isActive?: boolean;
  isCashAgent?: boolean;
  /** Books a TOPUP row so the agent starts with spendable float. */
  float?: number;
} = {}) {
  const n = nextId();
  const agent = await prisma.withdrawalAgent.create({
    data: {
      username: overrides.username ?? `agent_${n}`,
      passwordHash: TEST_PASSWORD_HASH,
      name: "Test Payout Agent",
      isActive: overrides.isActive ?? true,
      isCashAgent: overrides.isCashAgent ?? false,
      methods: overrides.methods ?? ["telebirr", "cbebirr", "ebirr"],
    },
  });
  if (overrides.float) {
    await prisma.withdrawalAgentTxn.create({
      data: { agentId: agent.id, type: "TOPUP", amount: overrides.float, note: "test float" },
    });
  }
  return agent;
}

export async function makeDepositRequest(userId: string, overrides: {
  amount?: number;
  method?: string;
  status?: string;
  smsRef?: string;
} = {}) {
  return prisma.depositRequest.create({
    data: {
      userId,
      amount: overrides.amount ?? 100,
      method: overrides.method ?? "telebirr",
      receiptText: "test receipt",
      status: overrides.status ?? "PENDING",
      smsRef: overrides.smsRef ?? null,
    },
  });
}

export async function makeSpinPrize(overrides: {
  label?: string;
  kind?: string;
  cashEtb?: number;
  payoutPot?: string;
  weightBps?: number;
  stock?: number;
  sortOrder?: number;
  isActive?: boolean;
} = {}) {
  return prisma.spinPrize.create({
    data: {
      label: overrides.label ?? "Test Prize",
      kind: overrides.kind ?? "CASH",
      cashEtb: overrides.cashEtb ?? 100,
      payoutPot: overrides.payoutPot ?? "bonus",
      weightBps: overrides.weightBps ?? 1000,
      stock: overrides.stock ?? 100,
      sortOrder: overrides.sortOrder ?? 0,
      isActive: overrides.isActive ?? true,
    },
  });
}

/**
 * Immutable fixtures every test needs. Seeded once in globalSetup, and
 * deliberately NOT truncated between files.
 *
 * getRewardConfig() is read by register, deposit, withdraw, spin, the provider
 * callback and admin/users — with an empty reward_config table the whole app
 * falls back to code defaults, which is a different code path from production.
 */
export async function seedSharedFixtures(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_REWARD_CONFIG)) {
    await prisma.rewardConfig.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object },
    });
  }

  for (const id of ["telebirr", "cbebirr", "ebirr"]) {
    await prisma.paymentAgent.upsert({
      where: { id },
      create: { id, agentNumber: "0900000000", agentName: "Test Agent" },
      update: {},
    });
  }
}

/** Tables wiped between test files. Config/payment-agent rows survive. */
const PRESERVE = new Set(["_prisma_migrations", "reward_config", "payment_agents"]);

let truncateSql: string | null = null;

/**
 * One statement, one round trip. Called in each file's beforeAll — not
 * beforeEach, because every query is a Railway proxy round trip.
 */
export async function truncateAll(): Promise<void> {
  if (!truncateSql) {
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = rows
      .map((r) => r.tablename)
      .filter((t) => !PRESERVE.has(t))
      .map((t) => `"${t}"`);
    truncateSql = `TRUNCATE TABLE ${tables.join(",")} RESTART IDENTITY CASCADE`;
  }
  await prisma.$executeRawUnsafe(truncateSql);
}
