import { beforeEach, describe, expect, test } from "vitest";
import { redis } from "../fakeRedis";

/*
 * The fake stands in for Redis in every DB test, so the behaviours the app
 * relies on for correctness have to be right — particularly `SET NX`, which is
 * the deposit idempotency lock, and TTL expiry, which is the OTP lifetime.
 * A too-permissive fake would make double-credit tests pass while the real
 * thing was broken.
 */

beforeEach(() => redis.flushall());

describe("set/get", () => {
  test("round-trips", async () => {
    expect(await redis.set("k", "v")).toBe("OK");
    expect(await redis.get("k")).toBe("v");
  });

  test("missing key is null", async () => {
    expect(await redis.get("nope")).toBeNull();
  });

  test("overwrites without NX", async () => {
    await redis.set("k", "one");
    await redis.set("k", "two");
    expect(await redis.get("k")).toBe("two");
  });
});

describe("SET NX — the idempotency lock", () => {
  test("first caller wins, second gets null", async () => {
    // This is exactly approveDeposit's guard against crediting a replayed SMS.
    expect(await redis.set("used:ref:X", "1", "EX", 60, "NX")).toBe("OK");
    expect(await redis.set("used:ref:X", "1", "EX", 60, "NX")).toBeNull();
  });

  test("NX succeeds again once the key has expired", async () => {
    await redis.set("k", "1", "EX", 1, "NX");
    redis.store.set("k", { value: "1", expiresAt: Date.now() - 1 }); // force expiry
    expect(await redis.set("k", "1", "EX", 60, "NX")).toBe("OK");
  });
});

describe("expiry", () => {
  test("an expired key reads as missing", async () => {
    await redis.set("k", "v", "EX", 60);
    redis.store.set("k", { value: "v", expiresAt: Date.now() - 1 });
    expect(await redis.get("k")).toBeNull();
  });

  test("no EX means no expiry", async () => {
    await redis.set("k", "v");
    expect(await redis.ttl("k")).toBe(-1);
  });

  test("ttl reports -2 for a missing key", async () => {
    expect(await redis.ttl("nope")).toBe(-2);
  });
});

describe("del / incr / mget", () => {
  test("del removes and counts", async () => {
    await redis.set("a", "1");
    await redis.set("b", "2");
    expect(await redis.del("a", "b", "missing")).toBe(2);
    expect(await redis.get("a")).toBeNull();
  });

  test("incr starts from zero and accumulates — the OTP attempt counter", async () => {
    expect(await redis.incr("otp:attempts:x")).toBe(1);
    expect(await redis.incr("otp:attempts:x")).toBe(2);
  });

  test("mget preserves order and nulls", async () => {
    await redis.set("a", "1");
    expect(await redis.mget("a", "missing")).toEqual(["1", null]);
  });
});

describe("scan — the unmatched-SMS admin view", () => {
  test("matches a prefix pattern and ignores others", async () => {
    await redis.set("sms:ref:1", "a");
    await redis.set("sms:raw:2", "b");
    await redis.set("otp:+2519", "c");

    const [cursor, keys] = await redis.scan("0", "MATCH", "sms:*", "COUNT", 100);
    expect(cursor).toBe("0");
    expect(keys.sort()).toEqual(["sms:raw:2", "sms:ref:1"]);
  });
});

describe("pub/sub — the SSE balance stream", () => {
  test("a subscriber receives a published message", async () => {
    const sub = redis.duplicate();
    const seen: string[] = [];
    sub.on("message", (_ch, msg) => seen.push(msg));
    await sub.subscribe("balance:user1");

    await redis.publish("balance:user1", JSON.stringify({ balance: 100 }));

    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0])).toEqual({ balance: 100 });
    await sub.quit();
  });

  test("messages on other channels are not delivered", async () => {
    const sub = redis.duplicate();
    const seen: string[] = [];
    sub.on("message", (_ch, msg) => seen.push(msg));
    await sub.subscribe("balance:user1");

    await redis.publish("balance:user2", "nope");

    expect(seen).toHaveLength(0);
    await sub.quit();
  });
});
