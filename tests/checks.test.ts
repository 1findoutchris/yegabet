/// <reference types="vite/client" />
import { test } from "vitest";

/*
 * Runs the hand-written `src/lib/*.check.ts` self-checks (9 files, ~215 asserts
 * covering the money math) as one Vitest suite.
 *
 * Those files assert at import time, so a failure rejects the dynamic import
 * and surfaces here with the original node:assert message and stack. They are
 * deliberately left untouched — wrapping 215 asserts in test() blocks would be
 * 851 lines of churn for granularity nobody needs. New *.check.ts files are
 * picked up automatically.
 */
const checks: Record<string, () => Promise<unknown>> =
  import.meta.glob("../src/lib/*.check.ts");

for (const [file, load] of Object.entries(checks)) {
  test(file.replace("../src/lib/", ""), async () => { await load(); });
}
