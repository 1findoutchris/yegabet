import { ConfigError, loadEnv } from "../../src/config/env";

const valid = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

describe("loadEnv", () => {
  it("accepts a minimal valid env and fills defaults", () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      PLATFORM_NAME: "Platform",
      PLATFORM_DOMAIN: "example.com",
      APP_VERSION: "dev",
    });
    expect(env.REDIS_URL).toBeUndefined();
  });

  it("parses PORT and keeps a set REDIS_URL", () => {
    const env = loadEnv({ ...valid, PORT: "8080", REDIS_URL: "redis://localhost:6379" });
    expect(env.PORT).toBe(8080);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("treats an empty REDIS_URL as unset", () => {
    expect(loadEnv({ ...valid, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
  });

  it("rejects a missing DATABASE_URL with a readable message", () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
    try {
      loadEnv({});
    } catch (e) {
      expect((e as ConfigError).problems.join()).toContain("DATABASE_URL");
    }
  });

  it("rejects a non-postgres DATABASE_URL, a bad NODE_ENV and a bad PORT together", () => {
    try {
      loadEnv({ DATABASE_URL: "mysql://x", NODE_ENV: "staging", PORT: "99999" });
      throw new Error("should have thrown");
    } catch (e) {
      const problems = (e as ConfigError).problems;
      expect(problems).toHaveLength(3);
      expect((e as Error).message).toContain("Invalid configuration");
    }
  });
});
