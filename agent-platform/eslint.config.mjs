import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["web/dist/**", "dist/**", "coverage/**", "node_modules/**", "jest.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Money must never be a float: ban parseFloat outright.
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Money is bigint santim; never parse floats." },
      ],
    },
  },
);
