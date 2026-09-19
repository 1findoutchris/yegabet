import bcrypt from "bcryptjs";
import { expect, test } from "vitest";
import { TEST_PASSWORD, TEST_PASSWORD_HASH } from "../factories";

/*
 * The fixture password hash is hardcoded so the suite doesn't pay ~200ms of
 * bcrypt per user. That optimisation is only safe if the constant is real —
 * a stale or mistyped hash would fail every login/E2E test with a misleading
 * "incorrect phone number or password", which is a miserable thing to debug.
 *
 * Lives in the unit project so it runs with no database.
 */
test("the precomputed fixture hash really matches TEST_PASSWORD", () => {
  expect(bcrypt.compareSync(TEST_PASSWORD, TEST_PASSWORD_HASH)).toBe(true);
});

test("and does not match anything else", () => {
  expect(bcrypt.compareSync("wrong-password", TEST_PASSWORD_HASH)).toBe(false);
});
