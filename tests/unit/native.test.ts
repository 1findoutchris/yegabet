import { describe, expect, it } from "vitest";
import { compareVersions, updateState, versionPolicy } from "@/lib/appVersion";
import { inAppPath } from "@/lib/deepLink";

describe("compareVersions", () => {
  it("compares numerically, part by part", () => {
    expect(compareVersions("1.10.0", "1.9.3")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
    expect(compareVersions("2", "10")).toBe(-1);
  });
});

describe("updateState", () => {
  const policy = { minVersion: "1.2.0", latestVersion: "1.4.0", storeUrl: null };
  it("blocks builds below the minimum", () => expect(updateState("1.1.9", policy)).toBe("required"));
  it("nudges builds below the latest", () => expect(updateState("1.3.0", policy)).toBe("available"));
  it("leaves current builds alone", () => expect(updateState("1.4.0", policy)).toBe("current"));
  it("does nothing when unset", () =>
    expect(updateState("0.1", { minVersion: null, latestVersion: null, storeUrl: null })).toBe("current"));
});

describe("versionPolicy", () => {
  it("reads the platform's variables", () => {
    expect(versionPolicy("ios", { APP_IOS_MIN_VERSION: "1.0", APP_ANDROID_MIN_VERSION: "2.0" })).toEqual({
      minVersion: "1.0", latestVersion: null, storeUrl: null,
    });
  });
});

describe("inAppPath", () => {
  it("maps universal links on vinna.bet", () => {
    expect(inAppPath("https://vinna.bet/tickets/ABC?x=1#y")).toBe("/tickets/ABC?x=1#y");
    expect(inAppPath("https://www.vinna.bet/check")).toBe("/check");
  });
  it("maps the custom scheme", () => {
    expect(inAppPath("vinnabet://tickets/ABC")).toBe("/tickets/ABC");
    expect(inAppPath("vinnabet://check?code=T1")).toBe("/check?code=T1");
    expect(inAppPath("vinnabet://")).toBe("/");
  });
  it("ignores other hosts and junk", () => {
    expect(inAppPath("https://evil.example/vinna.bet")).toBeNull();
    expect(inAppPath("https://vinna.bet.evil.example/")).toBeNull();
    expect(inAppPath("http://vinna.bet/")).toBeNull();
    expect(inAppPath("not a url")).toBeNull();
  });
});
