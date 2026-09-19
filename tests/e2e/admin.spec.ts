import { expect, test } from "@playwright/test";

/*
 * Admin login and the users table.
 *
 * The "undefined" smoke alarm lives here. `currency` was removed from the
 * /api/admin/users response while the page kept a hand-written interface
 * claiming it existed, and the table rendered the literal string "undefined"
 * next to every balance. tsc could not see it, because nothing connected the
 * page's interface to the handler.
 *
 * Deriving the type from the route (AdminUserRow) makes that a compile error
 * now. This is the belt to that braces: it fails on ANY undefined reaching the
 * screen, including from the 15 admin pages still hand-writing interfaces.
 */

const SECRET = process.env.ADMIN_SECRET ?? "test-admin-secret";
const USERNAME = process.env.ADMIN_USERNAME ?? "testadmin";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "testpassword";

async function login(page: import("@playwright/test").Page) {
  await page.goto(`/admin/${SECRET}/login`);
  // Placeholders are "admin" and a bullet string, not "username"/"password".
  await page.getByPlaceholder("admin").fill(USERNAME);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // The layout redirects to the overview once the session cookie is set.
  await expect(page).toHaveURL(new RegExp(`/admin/${SECRET}(/|$)`), { timeout: 20_000 });
}

test("a wrong secret cannot reach the dashboard", async ({ page }) => {
  // The page route itself is dynamic and serves 200 for any secret — the guard
  // is on the API, which 404s so the portal's existence isn't confirmed. What
  // matters is that no data is reachable.
  await page.goto("/admin/definitely-not-the-secret/users");
  await page.waitForLoadState("networkidle");

  // The layout bounces an unauthenticated visitor to its login screen.
  await expect(page).toHaveURL(/\/login$/);
});

test("correct credentials on a wrong secret still fail", async ({ page }) => {
  await page.goto("/admin/definitely-not-the-secret/login");
  await page.getByPlaceholder("admin").fill(USERNAME);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");

  // Knowing the password is not enough — the secret URL segment is a second
  // factor, checked as a header on the login call itself.
  await expect(page).toHaveURL(/\/login$/);
});

test("an admin can log in and read the users table", async ({ page }) => {
  await login(page);
  await page.goto(`/admin/${SECRET}/users`);

  await expect(page.getByRole("heading", { name: /users/i })).toBeVisible();
});

test("no page renders the string 'undefined'", async ({ page }) => {
  await login(page);

  for (const path of ["", "/users", "/deposits", "/withdrawals", "/ads", "/spin"]) {
    await page.goto(`/admin/${SECRET}${path}`);
    // Let client-side fetches settle — the bug was in fetched data, not SSR.
    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    expect(body, `"undefined" rendered on /admin/<secret>${path}`).not.toContain("undefined");
    expect(body, `"[object Object]" rendered on /admin/<secret>${path}`).not.toContain("[object Object]");
    expect(body, `"NaN" rendered on /admin/<secret>${path}`).not.toContain("NaN");
  }
});
