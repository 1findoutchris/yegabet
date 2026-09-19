import { expect, test } from "@playwright/test";

/*
 * Link attribution survives the landing redirect.
 *
 * This is a regression test for a bug that shipped: `/` was
 * `redirect("/casino")`, which DROPS the query string. Every shared link goes
 * through `/` — `/?ref=CODE` from ReferralCard and `/?promo=CODE` from an
 * admin guaranteed-win link — so the code was gone before any client code
 * could read it. Referral credit and promised prizes were both being lost with
 * no error anywhere, on every single signup.
 *
 * Only an E2E test sees this: the redirect is server-side and the capture is
 * client-side, so neither a unit nor a route test spans it.
 */

test("?ref= survives the root redirect", async ({ page }) => {
  await page.goto("/?ref=ABC123");

  await expect(page).toHaveURL(/\/casino\?.*ref=ABC123/);
});

test("?promo= survives the root redirect", async ({ page }) => {
  await page.goto("/?promo=TESTCODE123");

  await expect(page).toHaveURL(/\/casino\?.*promo=TESTCODE123/);
});

test("both params survive together", async ({ page }) => {
  await page.goto("/?ref=ABC123&promo=TESTCODE123");

  await expect(page).toHaveURL(/ref=ABC123/);
  await expect(page).toHaveURL(/promo=TESTCODE123/);
});

test("attribution is stashed and outlives navigating away", async ({ page }) => {
  // The second half of the fix: the params are read at SUBMIT time, so a
  // visitor who clicks around before registering would otherwise lose them.
  await page.goto("/?ref=ABC123&promo=TESTCODE123");
  await expect(page).toHaveURL(/ref=ABC123/);

  await page.goto("/games");
  await expect(page).toHaveURL(/\/games$/);

  const stashed = await page.evaluate(() => ({
    ref: sessionStorage.getItem("signup:ref"),
    promo: sessionStorage.getItem("signup:promo"),
  }));

  expect(stashed.ref).toBe("ABC123");
  expect(stashed.promo).toBe("TESTCODE123");
});

test("a plain visit redirects cleanly with no stray query string", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/casino$/);
});
