import { PrismaClient } from "@prisma/client";

/**
 * DB tests run against TEST_DATABASE_URL (default: the local throwaway server).
 * The setup wipes the schema, so it refuses any database not named *_test.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:54329/agent_platform_test";

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run DB tests against "${name}": the database name must end in _test`);
  }
}

export function testPrisma(): PrismaClient {
  assertTestDatabase(TEST_DATABASE_URL);
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("connection_limit", "25");
  url.searchParams.set("pool_timeout", "60");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

/** A unique owner id per test, so tests never share accounts. */
let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}`;
}

/** ETB → santim, from a string so no float ever appears: etb("25.50") === 2550n. */
export function etb(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) throw new Error(`bad ETB amount: ${amount}`);
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}
