import { expect, test } from "@playwright/test";
import { clearSms, waitForOtp } from "./smsSink";

/*
 * Registration, end to end, through the real SMS OTP step.
 *
 * The security regression this pins: typing the trunk `0` (`0912345678`)
 * produced `+251091234567`, which failed to normalise, so /api/auth/otp/send
 * returned { skip: true } and the client created the account with NO
 * verification at all. Unit tests cover normalizePhone and the route; this
 * covers what a real person typing into the real form actually gets.
 */

/** Unique per run so re-runs don't collide on the phone unique index. */
function uniqueLocalPhone(): string {
  const n = Date.now() % 100_000_000;
  return String(n).padStart(9, "0").replace(/^./, "9");
}

async function openRegister(page: import("@playwright/test").Page) {
  await page.goto("/casino");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByPlaceholder(/full name/i)).toBeVisible();
}

test("a new player can register through the OTP step", async ({ page }) => {
  clearSms();
  const local = uniqueLocalPhone();

  await openRegister(page);
  await page.getByPlaceholder(/full name/i).fill("E2E Player");
  await page.getByPlaceholder(/9XXXXXXXX/i).fill(local);
  await page.getByPlaceholder(/password \(min/i).fill("test1234");
  await page.getByPlaceholder(/confirm password/i).fill("test1234");
  await page.getByRole("button", { name: /create account/i }).click();

  // OTP step — the code only exists in the SMS the app just sent.
  await expect(page.getByPlaceholder("000000")).toBeVisible({ timeout: 20_000 });
  const code = await waitForOtp(`+251${local}`);

  await page.getByPlaceholder("000000").fill(code);
  await page.getByRole("button", { name: /verify/i }).click();

  // Signed in: the modal closes and the nav shows a balance.
  await expect(page.getByPlaceholder("000000")).toBeHidden({ timeout: 20_000 });
});

test("the trunk 0 is normalised rather than bypassing verification", async ({ page }) => {
  clearSms();
  const local = uniqueLocalPhone();

  await openRegister(page);
  await page.getByPlaceholder(/full name/i).fill("Trunk Zero");
  // Type it the way Ethiopians write it — with the leading 0.
  await page.getByPlaceholder(/9XXXXXXXX/i).fill(`0${local}`);
  await page.getByPlaceholder(/password \(min/i).fill("test1234");
  await page.getByPlaceholder(/confirm password/i).fill("test1234");

  // The field strips the trunk 0 as you type, so the stored value is valid.
  await expect(page.getByPlaceholder(/9XXXXXXXX/i)).toHaveValue(local);

  await page.getByRole("button", { name: /create account/i }).click();

  // The account must NOT be created without verification: an OTP step appears.
  await expect(page.getByPlaceholder("000000")).toBeVisible({ timeout: 20_000 });
  await expect(waitForOtp(`+251${local}`)).resolves.toMatch(/^\d{6}$/);
});

test("an incomplete number cannot be submitted at all", async ({ page }) => {
  await openRegister(page);
  await page.getByPlaceholder(/full name/i).fill("Too Short");
  await page.getByPlaceholder(/9XXXXXXXX/i).fill("91234"); // 5 digits
  await page.getByPlaceholder(/password \(min/i).fill("test1234");
  await page.getByPlaceholder(/confirm password/i).fill("test1234");

  // The submit gate requires exactly 9 digits starting 7 or 9, so a malformed
  // number never reaches the endpoint that used to reply { skip: true }.
  await expect(page.getByRole("button", { name: /create account/i })).toBeDisabled();
});
