/*
 * Self-check for multi-handset OTP delivery.
 * Run: `npx tsx src/lib/sms.check.ts`
 *
 * Two rules matter here: a half-configured phone must never enter the pool (it
 * would 401 every message routed to it), and one send must try every phone
 * exactly once whichever it starts from — that is what makes the second handset
 * a failover and not just decoration.
 */
import assert from "node:assert";
import { smsGateways, rotated, enabledOnly, tryOrder } from "./sms";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

// ── reading the pool out of the environment ──────────────────────────────────
{
  const gws = smsGateways(env({}));
  assert.deepStrictEqual(gws, [], "nothing configured → no gateways, never a fake one");
}
{
  const gws = smsGateways(env({ SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1" }));
  assert.strictEqual(gws.length, 1, "one pair → one phone");
  assert.strictEqual(gws[0].label, "1");
  assert.strictEqual(gws[0].url, "https://api.sms-gate.app/3rdparty/v1/messages", "cloud default");
}
{
  const gws = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
  }));
  assert.strictEqual(gws.length, 2, "two pairs → two phones");
  assert.deepStrictEqual(
    gws.map((g) => g.kind === "smsgate" && g.user),
    ["u1", "u2"],
    "env order is preserved",
  );
  assert.deepStrictEqual(gws.map((g) => g.label), ["1", "2"], "labels identify a failing phone in logs");
}
{
  // The typo case: the whole point of skipping rather than half-configuring.
  const gws = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", // password forgotten
  }));
  assert.strictEqual(gws.length, 1, "a pair missing its password must not join the pool");
  assert.strictEqual(gws[0].kind === "smsgate" && gws[0].user, "u1");
}
{
  // A self-hosted second phone, and the shared-URL fallback for the first.
  const gws = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
    SMSGATE_URL: "https://shared.example/messages",
    SMSGATE_URL_2: "http://10.0.0.5:8080/messages",
  }));
  assert.strictEqual(gws[0].url, "https://shared.example/messages", "phone 1 takes the shared URL");
  assert.strictEqual(gws[1].url, "http://10.0.0.5:8080/messages", "phone 2 overrides it");
}
{
  const gws = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
    SMSGATE_USERNAME_3: "u3", SMSGATE_PASSWORD_3: "p3",
    SMSGATE_USERNAME_4: "u4", SMSGATE_PASSWORD_4: "p4",
    SMSGATE_USERNAME_5: "u5", SMSGATE_PASSWORD_5: "p5",
  }));
  assert.strictEqual(gws.length, 5, "five handsets are supported");
  assert.deepStrictEqual(gws.map((g) => g.label), ["1", "2", "3", "4", "5"]);
}

// ── the try order: every phone once, from any starting point ─────────────────
{
  assert.deepStrictEqual(rotated([], 3), [], "an empty pool must not throw or divide by zero");
  assert.deepStrictEqual(rotated(["a"], 7), ["a"], "a single phone is tried once");

  for (let start = 0; start < 6; start++) {
    const order = rotated(["a", "b", "c"], start);
    assert.strictEqual(order.length, 3, `start ${start}: every phone must be attempted`);
    assert.strictEqual(new Set(order).size, 3, `start ${start}: no phone attempted twice`);
    assert.strictEqual(order[0], ["a", "b", "c"][start % 3], `start ${start}: wrong first pick`);
  }
}
{
  // Failover direction: starting at the last phone must wrap to the first,
  // otherwise a send that begins on the dead phone has nowhere to go.
  assert.deepStrictEqual(rotated(["a", "b"], 1), ["b", "a"]);
  assert.deepStrictEqual(rotated(["a", "b"], -1), ["b", "a"], "a negative index still lands in range");
}

// ── the admin kill switch ────────────────────────────────────────────────────
{
  const pool = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
    SMSGATE_USERNAME_3: "u3", SMSGATE_PASSWORD_3: "p3",
  }));

  assert.deepStrictEqual(
    enabledOnly(pool, new Set()).map((g) => g.label),
    ["1", "2", "3"],
    "no switches set → every configured phone sends, which is how this behaved before the table existed",
  );
  assert.deepStrictEqual(
    enabledOnly(pool, new Set(["2"])).map((g) => g.label),
    ["1", "3"],
    "a disabled phone must not appear in the try order at all — failover would otherwise still reach it",
  );
  assert.deepStrictEqual(
    enabledOnly(pool, new Set(["1", "2", "3"])).length,
    0,
    "everything off means nothing to send through, not a silent fallback to phone 1",
  );
  assert.deepStrictEqual(
    enabledOnly(pool, new Set(["9"])).map((g) => g.label),
    ["1", "2", "3"],
    "a row for a handset that's since left the env disables nobody",
  );

  // The two rules compose: rotation still covers exactly the surviving phones.
  const survivors = enabledOnly(pool, new Set(["1"]));
  assert.deepStrictEqual(rotated(survivors, 1).map((g) => g.label), ["3", "2"]);
  assert.strictEqual(new Set(rotated(survivors, 5).map((g) => g.label)).size, 2, "no survivor tried twice");
}

// ── AfroMessage: the paid carrier behind the free phones ─────────────────────
{
  const phones = {
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
  };

  assert.deepStrictEqual(
    smsGateways(env(phones)).map((g) => g.kind),
    ["smsgate", "smsgate"],
    "no API key → no carrier invented, and nothing bills",
  );

  const gws = smsGateways(env({ ...phones, AFROMESSAGE_API_KEY: "tok" }));
  assert.strictEqual(gws.length, 3, "the key alone is enough to add the carrier");
  const afro = gws[2];
  assert.strictEqual(afro.kind, "afro");
  assert.strictEqual(afro.label, "afro", "its own label, so the admin switch addresses it");
  assert.strictEqual(afro.url, "https://api.afromessage.com/api/send");
  assert.strictEqual(afro.kind === "afro" && afro.sender, undefined, "unset sender stays absent, not empty-string");

  const named = smsGateways(env({ AFROMESSAGE_API_KEY: "tok", AFROMESSAGE_SENDER: "YegaBet", AFROMESSAGE_FROM: "id-1" }));
  assert.strictEqual(named.length, 1, "the carrier works with no handsets at all");
  assert.strictEqual(named[0].kind === "afro" && named[0].sender, "YegaBet");
  assert.strictEqual(named[0].kind === "afro" && named[0].from, "id-1");
}

// ── the try order: free phones first, carrier last ───────────────────────────
{
  const gws = smsGateways(env({
    SMSGATE_USERNAME: "u1", SMSGATE_PASSWORD: "p1",
    SMSGATE_USERNAME_2: "u2", SMSGATE_PASSWORD_2: "p2",
    AFROMESSAGE_API_KEY: "tok",
  }));

  for (let start = 0; start < 4; start++) {
    const order = tryOrder(gws, start).map((g) => g.label);
    assert.strictEqual(order.length, 3, `start ${start}: every gateway still gets a turn`);
    assert.strictEqual(new Set(order).size, 3, `start ${start}: none tried twice`);
    // This is the cost rule: whichever handset leads, the paid one is last.
    assert.strictEqual(order[2], "afro", `start ${start}: carrier must never be tried before a free phone`);
  }

  // Switching every handset off promotes the carrier by elimination — the
  // manual override when the phones are down.
  assert.deepStrictEqual(
    tryOrder(enabledOnly(gws, new Set(["1", "2"])), 0).map((g) => g.label),
    ["afro"],
  );
  // And the carrier obeys the same switch as everything else.
  assert.deepStrictEqual(
    tryOrder(enabledOnly(gws, new Set(["afro"])), 0).map((g) => g.label).sort(),
    ["1", "2"],
  );
  assert.deepStrictEqual(tryOrder([], 3), [], "nothing configured must not throw");
}

console.log("sms self-check passed");
