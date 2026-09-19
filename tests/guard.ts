/*
 * The one thing standing between `npm run test:db` and wiping production.
 *
 * The DB suite runs `prisma migrate reset`, which DROPS EVERYTHING. This
 * project has already had a reset run against the live Railway database once.
 * A typo in an env file must not be able to do that again.
 *
 * Called from tests/db/globalSetup.ts before any Prisma import or migration,
 * and again from tests/db/setup.ts inside the worker in case env did not cross
 * the fork boundary. Every failure throws, which aborts the entire Vitest run
 * before a single test file is loaded — fail closed, never fail open.
 */

/** Hosts known to serve real user data. Belt and braces on top of the name check. */
const PRODUCTION_HOSTS = ["acela.proxy.rlwy.net"];

/** A test database must say so in its name: vamos_test, test-db, my_test_1… */
const TEST_NAME = /(^|[_-])test([_-]|\d|$)/i;

function identity(url: URL): string {
  return `${url.hostname}:${url.port}/${url.pathname.slice(1)}`;
}

/**
 * Validates TEST_DATABASE_URL and points the process at it.
 *
 * This is the ONLY place the suite assigns DATABASE_URL — there is deliberately
 * no `db:reset:test` npm script and no bare `prisma migrate reset` anywhere, so
 * the guarded path is the only path to a destructive command.
 *
 * @returns the validated test database URL
 * @throws if the URL is missing, not named as a test DB, a known production
 *         host, or the same database DATABASE_URL points at
 */
export function assertTestDatabase(): string {
  const raw = process.env.TEST_DATABASE_URL;

  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set — refusing to run database tests.\n" +
        "Create a SEPARATE Railway Postgres named `vamos_test` and put its URL in .env.test.\n" +
        "See .env.test.example.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL — refusing to run database tests.");
  }

  const name = url.pathname.slice(1);

  if (!TEST_NAME.test(name)) {
    throw new Error(
      `Refusing to run: database "${name}" is not named as a test database.\n` +
        "The name must contain a `test` token (e.g. vamos_test). This is the guard that\n" +
        "stops a mistyped URL from dropping every table in production.",
    );
  }

  if (PRODUCTION_HOSTS.includes(url.hostname)) {
    throw new Error(
      `Refusing to run: ${url.hostname} is a known production host.\n` +
        "The database suite runs `prisma migrate reset`, which drops every table.",
    );
  }

  // Skip the "must differ" check once we've already redirected: globalSetup
  // runs in the parent and sets DATABASE_URL to the test URL, so by the time
  // the worker re-runs this they are equal BY DESIGN. Without the marker the
  // guard refuses its own handiwork.
  //
  // Nothing is lost: a genuine production URL is already rejected above by the
  // name check (Railway's default database is `railway`) and the host check.
  if (process.env.__TEST_DB_REDIRECTED !== "1") {
    const prod = process.env.DATABASE_URL;
    if (prod) {
      let prodUrl: URL | null = null;
      try {
        prodUrl = new URL(prod);
      } catch {
        /* an unparseable DATABASE_URL can't collide; nothing to compare */
      }
      if (prodUrl && identity(prodUrl) === identity(url)) {
        throw new Error(
          "Refusing to run: TEST_DATABASE_URL resolves to the same host/port/database as DATABASE_URL.\n" +
            "These must be two different databases.",
        );
      }
    }
  }

  // Everything downstream (Prisma client, the CLI, the factories) reads
  // DATABASE_URL. Redirect it here, once, after the checks have passed.
  process.env.DATABASE_URL = raw;
  process.env.__TEST_DB_REDIRECTED = "1";
  return raw;
}
