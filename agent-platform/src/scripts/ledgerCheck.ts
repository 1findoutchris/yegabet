import { PrismaClient } from "@prisma/client";
import { Ledger } from "../ledger/ledger";

/**
 * Post-deploy money check (plan 02 §10, CLAUDE.md §10 "verify ledger totals
 * still balance"). Read-only. Exits 1 if any invariant or the cache is off.
 *   npm run ledger:check
 */
async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const ledger = new Ledger(db);
    const report = await ledger.checkInvariants();
    const drift = await ledger.reconcile();
    console.log(
      JSON.stringify(
        {
          sumOfBalances: report.sumOfBalances.toString(),
          sumOfDerived: report.sumOfDerived.toString(),
          negativeViolations: report.negativeViolations.map(String),
          cacheDrift: drift.map((d) => ({
            accountId: String(d.accountId),
            cached: String(d.cached),
            derived: String(d.derived),
          })),
          ok: report.ok && drift.length === 0,
        },
        null,
        2,
      ),
    );
    if (!report.ok || drift.length > 0) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
