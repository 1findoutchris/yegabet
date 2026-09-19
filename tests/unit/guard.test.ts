import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertTestDatabase } from "../guard";

/*
 * Tests for the guard itself.
 *
 * This runs in the `unit` project on purpose — it must pass with no database
 * anywhere, and it is the one piece of the suite whose failure mode is
 * "production data is gone". It gets tested like it.
 */

const LIVE = "postgresql://u:p@acela.proxy.rlwy.net:39188/railway";
const TEST = "postgresql://u:p@other.proxy.rlwy.net:12345/vamos_test";

let saved: { db?: string; test?: string };

beforeEach(() => {
  saved = { db: process.env.DATABASE_URL, test: process.env.TEST_DATABASE_URL };
  delete process.env.DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.__TEST_DB_REDIRECTED;
});

afterEach(() => {
  // Never leak a mutated DATABASE_URL into another test file.
  if (saved.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.db;
  if (saved.test === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = saved.test;
  delete process.env.__TEST_DB_REDIRECTED;
});

test("is idempotent — a second call after redirecting does not refuse itself", () => {
  // globalSetup redirects DATABASE_URL, then the worker re-runs the guard. The
  // two URLs are equal by design at that point.
  process.env.TEST_DATABASE_URL = TEST;
  assertTestDatabase();
  expect(process.env.DATABASE_URL).toBe(TEST);
  expect(() => assertTestDatabase()).not.toThrow();
});

describe("refuses to run", () => {
  test("when TEST_DATABASE_URL is unset", () => {
    expect(() => assertTestDatabase()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  test("against the known production host", () => {
    // The exact catastrophe: someone pastes the live URL into .env.test.
    process.env.TEST_DATABASE_URL = LIVE;
    expect(() => assertTestDatabase()).toThrow(/not named as a test database/);
  });

  test("against a production host even if the name looks like a test", () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://u:p@acela.proxy.rlwy.net:39188/vamos_test";
    expect(() => assertTestDatabase()).toThrow(/known production host/);
  });

  test.each([
    ["railway", "the Railway default name"],
    ["postgres", "the Postgres default name"],
    ["vamos", "the app name with no test token"],
    ["production", "contains no test token"],
    ["latest", "contains 'test' only as a substring of another word"],
    ["contest", "same — 'test' inside a word is not a test database"],
  ])("when the database is named %s (%s)", (dbName) => {
    process.env.TEST_DATABASE_URL = `postgresql://u:p@host.example:5432/${dbName}`;
    expect(() => assertTestDatabase()).toThrow(/not named as a test database/);
  });

  test("when it points at the same database as DATABASE_URL", () => {
    process.env.DATABASE_URL = TEST;
    process.env.TEST_DATABASE_URL = TEST;
    expect(() => assertTestDatabase()).toThrow(/same host\/port\/database/);
  });

  test("when the URL is unparseable", () => {
    process.env.TEST_DATABASE_URL = "not a url";
    expect(() => assertTestDatabase()).toThrow(/not a valid URL/);
  });

  test("leaves DATABASE_URL untouched when it refuses", () => {
    process.env.DATABASE_URL = LIVE;
    process.env.TEST_DATABASE_URL = LIVE;
    expect(() => assertTestDatabase()).toThrow();
    // If a refusal still redirected DATABASE_URL, the next thing to run would
    // point somewhere unexpected.
    expect(process.env.DATABASE_URL).toBe(LIVE);
  });
});

describe("accepts", () => {
  test.each(["vamos_test", "test", "test_db", "my-test-db", "vamos_test_2"])(
    "a database named %s",
    (dbName) => {
      process.env.TEST_DATABASE_URL = `postgresql://u:p@host.example:5432/${dbName}`;
      expect(() => assertTestDatabase()).not.toThrow();
    },
  );

  test("and redirects DATABASE_URL at the test database", () => {
    process.env.DATABASE_URL = LIVE;
    process.env.TEST_DATABASE_URL = TEST;

    expect(assertTestDatabase()).toBe(TEST);
    // Everything downstream — Prisma client, CLI, factories — reads this.
    expect(process.env.DATABASE_URL).toBe(TEST);
  });
});
