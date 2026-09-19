import { assertTestDatabase } from "../guard";
import { startSmsSink } from "./smsSink";

/*
 * Runs once, before Playwright starts the web server.
 *
 * The guard runs FIRST, for the same reason it does in the Vitest suite: this
 * truncates tables, and the app under test is pointed at whatever DATABASE_URL
 * says. A mistyped env must not be able to reach production.
 */
export default async function globalSetup() {
  try {
    process.loadEnvFile(".env.test");
  } catch {
    /* CI supplies env directly */
  }

  assertTestDatabase();

  const smsPort = Number(process.env.E2E_SMS_PORT ?? 4010);
  await startSmsSink(smsPort);
  console.log(`[e2e] SMS sink listening on 127.0.0.1:${smsPort}`);

  // Imported only after the guard has redirected DATABASE_URL — importing
  // Prisma earlier would bind it to the wrong database.
  const { seedSharedFixtures, truncateAll } = await import("../factories");
  await truncateAll();
  await seedSharedFixtures();
  console.log("[e2e] database truncated and seeded");
}
