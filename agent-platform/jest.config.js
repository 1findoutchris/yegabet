/** Two projects: `unit` needs nothing; `db` needs DATABASE_URL pointing at a disposable Postgres. */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
};

module.exports = {
  projects: [
    { ...base, displayName: "unit", testMatch: ["<rootDir>/test/unit/**/*.test.ts"] },
    {
      ...base,
      displayName: "db",
      testMatch: ["<rootDir>/test/db/**/*.test.ts"],
      globalSetup: "<rootDir>/test/db/globalSetup.ts",
    },
  ],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/scripts/**"],
  coverageThreshold: {
    "./src/ledger/": { branches: 100, functions: 100, lines: 100, statements: 100 },
    "./src/users/": { branches: 100, functions: 100, lines: 100, statements: 100 },
    "./src/auth/": { branches: 100, functions: 100, lines: 100, statements: 100 },
    "./src/telegram/": { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
};
