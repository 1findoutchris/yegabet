import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { POST as inbound } from "@/app/api/sms/inbound/route";
import { POST as userDeposit } from "@/app/api/user/deposit/route";
import { makeUser, truncateAll } from "../factories";
import { asUser } from "../helpers/session";
import { json, req } from "../helpers/req";

/*
 * Matching an agent's SMS to the player who actually paid.
 *
 * Two keys do the matching: `pending:ref:<ref>` (exact, per-transaction) and
 * `pending:amount:<amount>:<method>` — a single GLOBAL bucket that every player
 * waiting on the same figure shares. Routing a ref-carrying SMS through that
 * bucket credits a bystander and burns the reference, so the player who really
 * paid is told their receipt was "already processed". That is the regression
 * these tests pin.
 */

const SMS_SECRET = () => process.env.SMS_FORWARDER_SECRET ?? "test-sms-forwarder-secret";

const smsIn = (message: string, sender = "8031") =>
  inbound(req("POST", "/api/sms/inbound", {
    body: { secret: SMS_SECRET(), message, sender },
  }));

const deposit = (body: Record<string, unknown>) =>
  userDeposit(req("POST", "/api/user/deposit", { body }));

const balanceOf = async (id: string) =>
  Number((await prisma.user.findUniqueOrThrow({ where: { id } })).balance);

describe("agent SMS → deposit matching", () => {
  beforeEach(async () => {
    await truncateAll();
    redis.flushall();
  });

  test("a ref-carrying SMS never credits a bystander waiting on the same amount", async () => {
    const bystander = await makeUser({ balance: 0 });
    const payer = await makeUser({ balance: 0 });

    // Bystander is mid-deposit with a receipt that has no parsable reference,
    // so they hold the global amount bucket for 100 / telebirr.
    asUser(bystander);
    const waiting = await json<{ status: string; depositId: string }>(
      await deposit({ method: "telebirr", amount: 100, receiptText: "sent one hundred birr" }),
    );
    expect(waiting.body.status).toBe("PENDING");

    // The agent's SMS for the PAYER's 100 birr arrives first — before the payer
    // has pasted their own receipt, which is the normal ordering.
    const ref = "TX123456789";
    await smsIn(`Dear agent, you have received ETB 100.00 from 251912345678 via telebirr. Ref: ${ref}`);

    // Nobody is credited on the strength of the amount alone.
    expect(await balanceOf(bystander.id)).toBe(0);
    expect(
      (await prisma.depositRequest.findUniqueOrThrow({ where: { id: waiting.body.depositId } })).status,
    ).toBe("PENDING");

    // The SMS is parked under its reference, and the reference is NOT burned.
    expect(await redis.get(`sms:ref:${ref}`)).toBeTruthy();
    expect(await redis.get(`used:ref:${ref}`)).toBeNull();

    // The payer pastes their receipt and is credited immediately.
    asUser(payer);
    const claimed = await json<{ status: string }>(
      await deposit({
        method: "telebirr",
        amount: 100,
        receiptText: `telebirr: you have sent ETB 100.00. Ref: ${ref}`,
      }),
    );
    expect(claimed.status).toBe(200);
    expect(claimed.body.status).toBe("APPROVED");
    expect(await balanceOf(payer.id)).toBe(100);
  });

  test("a ref-less SMS still matches on amount + method", async () => {
    const user = await makeUser({ balance: 0 });

    asUser(user);
    await deposit({ method: "cbebirr", amount: 100, receiptText: "sent one hundred birr" });

    // CBE Birr, received, no reference anywhere in the body.
    await smsIn("You have received 100.00 Br. from 251912345678", "127");

    expect(await balanceOf(user.id)).toBe(100);
  });

  test("re-pasting an approved receipt returns its status, not an error", async () => {
    const user = await makeUser({ balance: 0 });
    const ref = "TX987654321";

    await smsIn(`Dear agent, you have received ETB 100.00 from 251912345678 via telebirr. Ref: ${ref}`);

    asUser(user);
    const body = { method: "telebirr", amount: 100, receiptText: `telebirr sent ETB 100.00. Ref: ${ref}` };
    expect((await json<{ status: string }>(await deposit(body))).body.status).toBe("APPROVED");

    const again = await json<{ status: string }>(await deposit(body));
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("APPROVED");
    // Credited once, not twice.
    expect(await balanceOf(user.id)).toBe(100);
  });
});
