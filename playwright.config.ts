import { defineConfig, devices } from "@playwright/test";

// Loaded HERE, not in globalSetup: this file's `webServer.env` block is
// evaluated when the config is read, which happens before globalSetup runs.
// Without this, TEST_DATABASE_URL is empty and the app under test starts with
// no database. CI supplies the vars directly, so a missing file is fine.
try {
  process.loadEnvFile(".env.test");
} catch {
  /* CI, or no local file */
}

/*
 * End-to-end tests — the only layer that exercises routing, rendering and the
 * real Next server together.
 *
 * That matters because the bugs this suite exists to catch live exactly there:
 * a redirect that dropped `?promo=` and `?ref=` (killing referral credit and
 * guaranteed prizes with no error anywhere), and an API field removal that
 * rendered the literal string "undefined" in the admin table.
 *
 * Unlike the Vitest suites this needs REAL infrastructure — a Postgres and a
 * Redis — because the app under test is a separate process and cannot see
 * Vitest's module aliases.
 *
 *   npm test         → nothing required
 *   npm run test:db  → the test Postgres
 *   npm run test:e2e → the test Postgres AND a Redis
 */

const PORT = 3100; // not 3000, so a running `npm run dev` doesn't collide
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/globalSetup.ts",

  // One worker: these share a database, and several assert on global state
  // (an admin table, a payout queue).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // A production build, deliberately — `next dev` papers over RSC and build
    // errors that only surface when compiled, and those are precisely what an
    // E2E run should catch.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // The app under test talks to the TEST database, never DATABASE_URL.
      // globalSetup validates this through the same guard the Vitest suite uses.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379",

      // Outbound SMS is redirected to the local sink started in globalSetup, so
      // registration reaches the OTP step (rather than 502-ing on a failed
      // send) and the test can read the code out of the captured message.
      SMSGATE_URL: `http://127.0.0.1:${process.env.E2E_SMS_PORT ?? 4010}`,
      SMSGATE_USERNAME: "e2e",
      SMSGATE_PASSWORD: "e2e",

      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-auth-secret-not-used-in-production",
      NEXTAUTH_URL: BASE_URL,
      ADMIN_SECRET: process.env.ADMIN_SECRET ?? "test-admin-secret",
      ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "testadmin",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "testpassword",
      PAYOUT_SECRET: process.env.PAYOUT_SECRET ?? "test-payout-secret",
      SILENT_API_SECRET_KEY: process.env.SILENT_API_SECRET_KEY ?? "test-silent-hmac-secret",
      SMS_FORWARDER_SECRET: process.env.SMS_FORWARDER_SECRET ?? "test-sms-forwarder-secret",
      CRON_SECRET: process.env.CRON_SECRET ?? "test-cron-secret",

      // Only need to exist — silent-api.ts non-null-asserts them and calls
      // axios.create() at module load.
      SILENT_API_BASE_URL: "http://127.0.0.1:9/unused",
      SILENT_API_BEARER_TOKEN: "unused",
    },
  },
});
