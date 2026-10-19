import { MAX_AUTH_AGE_S, verifyInitData, verifyLoginWidget } from "../../src/auth/telegramSignature";
import { BOT_TOKEN, signInitData, signWidget } from "../telegramSign";

const nowS = () => Math.floor(Date.now() / 1000);

describe("Mini App initData", () => {
  it("accepts a correctly signed, fresh initData", () => {
    expect(verifyInitData(signInitData({ id: 42, first_name: "Abebe" }), BOT_TOKEN)).toMatchObject({
      id: "42",
      firstName: "Abebe",
    });
  });

  it("refuses a tampered field, a wrong token, a missing or malformed hash", () => {
    const good = signInitData({ id: 42 });
    expect(verifyInitData(good.replace("query_id=AAEtest", "query_id=AAEhack"), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(signInitData({ id: 42 }, { token: "999:other" }), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(good.replace(/&?hash=[0-9a-f]+/, ""), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(good.replace(/hash=[0-9a-f]+/, "hash=zz"), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(good.replace(/hash=[0-9a-f]+/, "hash=abcd"), BOT_TOKEN)).toBeNull();
  });

  it("refuses old, future and missing auth dates", () => {
    expect(
      verifyInitData(signInitData({ id: 1 }, { authDate: nowS() - MAX_AUTH_AGE_S - 3600 }), BOT_TOKEN),
    ).toBeNull();
    expect(verifyInitData(signInitData({ id: 1 }, { authDate: nowS() + 3600 }), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(signInitData({ id: 1 }, { extra: { auth_date: "soon" } }), BOT_TOKEN)).toBeNull();
    // 23 h old is still fine.
    expect(
      verifyInitData(signInitData({ id: 1 }, { authDate: nowS() - 23 * 3600 }), BOT_TOKEN),
    ).not.toBeNull();
  });

  it("refuses a bad user field even when signed", () => {
    expect(verifyInitData(signInitData({ id: 1 }, { extra: { user: "{not json" } }), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(signInitData({ id: 1 }, { extra: { user: "null" } }), BOT_TOKEN)).toBeNull();
    expect(
      verifyInitData(signInitData({ id: 1 }, { extra: { user: '{"first_name":"x"}' } }), BOT_TOKEN),
    ).toBeNull();
    expect(verifyInitData(signInitData({ id: "77" }), BOT_TOKEN)?.id).toBe("77");
  });

  it("refuses absurd input", () => {
    expect(verifyInitData("x".repeat(5000), BOT_TOKEN)).toBeNull();
    expect(verifyInitData(undefined as unknown as string, BOT_TOKEN)).toBeNull();
  });

  it("refuses signed initData without a user field", () => {
    expect(verifyInitData(signInitData({ id: 1 }, { omit: ["user"] }), BOT_TOKEN)).toBeNull();
  });
});

describe("Login Widget", () => {
  it("accepts correctly signed fields and ignores our own `as` field", () => {
    expect(
      verifyLoginWidget({ ...signWidget(42, { extra: { username: "abebe" } }), as: "player" }, BOT_TOKEN),
    ).toMatchObject({
      id: "42",
      username: "abebe",
    });
  });

  it("refuses tampering, a wrong token, a missing hash and non-scalar values", () => {
    expect(verifyLoginWidget({ ...signWidget(42), first_name: "Eve" }, BOT_TOKEN)).toBeNull();
    expect(verifyLoginWidget(signWidget(42, { token: "999:other" }), BOT_TOKEN)).toBeNull();
    const noHash: Record<string, string> = signWidget(42);
    delete noHash.hash;
    expect(verifyLoginWidget(noHash, BOT_TOKEN)).toBeNull();
    expect(verifyLoginWidget({ ...signWidget(42), photo: { x: 1 } } as never, BOT_TOKEN)).toBeNull();
    expect(verifyLoginWidget(null as never, BOT_TOKEN)).toBeNull();
  });

  it("refuses stale data and a non-numeric id", () => {
    expect(
      verifyLoginWidget(signWidget(42, { authDate: nowS() - MAX_AUTH_AGE_S - 1 }), BOT_TOKEN),
    ).toBeNull();
    expect(verifyLoginWidget(signWidget("abc"), BOT_TOKEN)).toBeNull();
    expect(verifyLoginWidget({ ...signWidget(42), auth_date: 1 } as never, BOT_TOKEN)).toBeNull();
  });
});
