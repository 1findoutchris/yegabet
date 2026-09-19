import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { redis } from "@/lib/redis";
import { truncateAll, makeUser } from "../factories";
import { json, req } from "../helpers/req";

/*
 * The registration OTP gate.
 *
 * This is where a real security bug lived: typing the trunk `0`
 * (`0912345678`) produced `+251091234567`, which failed to normalise, so the
 * route treated it as a FOREIGN number and returned `{ skip: true }` — and the
 * client then registered the account with no verification at all.
 *
 * The unit tests pin normalizePhone; these pin the ROUTE's reaction, which is
 * what actually decides whether an account is verified.
 */

// sendSms would otherwise make a real network call to smsgate (and, with no
// credentials set, return false → 502). Stub only the send; normalizePhone and
// isEthiopianAttempt must stay real, since they are what's under test.
const sent: { to: string; text: string }[] = [];
vi.mock("@/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms")>();
  return {
    ...actual,
    sendSms: async (to: string, text: string) => {
      sent.push({ to, text });
      return true;
    },
  };
});

const { POST } = await import("@/app/api/auth/otp/send/route");

const send = (body: Record<string, unknown>) =>
  POST(req("POST", "/api/auth/otp/send", { body }));

beforeAll(async () => {
  await truncateAll();
});

beforeEach(() => {
  sent.length = 0;
  redis.flushall(); // clears cooldowns between tests
});

describe("malformed Ethiopian numbers — the OTP bypass", () => {
  test.each([
    ["+251091234567", "the trunk 0 kept after the country code"],
    ["+25191234567", "8 digits — incomplete"],
    ["+251812345678", "invalid operator prefix"],
  ])("%s is rejected with 400, never { skip: true } (%s)", async (phone) => {
    const { status, body } = await json<{ skip?: boolean; error?: string }>(
      await send({ phone }),
    );

    // The whole point: `skip` would send the client straight to registration
    // with no verification.
    expect(body.skip).toBeUndefined();
    expect(status).toBe(400);
    expect(body.error).toMatch(/valid Ethiopian phone number/i);
    expect(sent).toHaveLength(0);
  });

  test("a too-short number is caught by zod before the Ethiopian check", async () => {
    // "+251" fails the schema's min(9) first, so the message differs — what
    // matters is that it is still a 400 and still not { skip: true }.
    const { status, body } = await json<{ skip?: boolean }>(await send({ phone: "+251" }));
    expect(status).toBe(400);
    expect(body.skip).toBeUndefined();
  });
});

describe("valid Ethiopian numbers", () => {
  test("get an OTP sent and a code stored", async () => {
    const { status, body } = await json<{ sent?: boolean }>(
      await send({ phone: "+251912345678" }),
    );

    expect(status).toBe(200);
    expect(body.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("+251912345678");

    // A 6-digit code is stored for the register route to verify against.
    const code = await redis.get("otp:+251912345678");
    expect(code).toMatch(/^\d{6}$/);
    expect(sent[0].text).toContain(code!);
  });

  test("the cooldown blocks an immediate resend with 429", async () => {
    await send({ phone: "+251912345679" });
    const { status } = await json(await send({ phone: "+251912345679" }));
    expect(status).toBe(429);
  });

  test("an already-registered number cannot request a registration OTP", async () => {
    const user = await makeUser({ phone: "+251912345670" });
    const { status, body } = await json<{ error?: string }>(
      await send({ phone: user.phone }),
    );
    expect(status).toBe(409);
    expect(body.error).toMatch(/already registered/i);
  });
});

describe("password reset", () => {
  test("an unknown number cannot request a reset code", async () => {
    const { status } = await json(
      await send({ phone: "+251912345671", purpose: "reset" }),
    );
    // Otherwise the endpoint mints codes for numbers with no account.
    expect(status).toBe(404);
  });

  test("a registered number can", async () => {
    const user = await makeUser({ phone: "+251912345672" });
    const { status, body } = await json<{ sent?: boolean }>(
      await send({ phone: user.phone, purpose: "reset" }),
    );
    expect(status).toBe(200);
    expect(body.sent).toBe(true);
  });

  test("a foreign number cannot reset — there is no rail to prove ownership", async () => {
    const { status, body } = await json<{ error?: string }>(
      await send({ phone: "+971501234567", purpose: "reset" }),
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/only available for Ethiopian/i);
  });
});

describe("genuinely foreign numbers", () => {
  test("registration skips OTP, because there is no SMS rail for them", async () => {
    // The legitimate `skip` path — this is what the malformed-number cases
    // above were wrongly falling into.
    const { status, body } = await json<{ skip?: boolean }>(
      await send({ phone: "+971501234567" }),
    );
    expect(status).toBe(200);
    expect(body.skip).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
