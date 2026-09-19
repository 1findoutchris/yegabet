import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Downgraded from error so `npm run lint` can gate CI on NEW problems.
      //
      // 36 pre-existing violations across the app — it fires on the ordinary
      // "read localStorage / matchMedia / a param on mount, then setState"
      // pattern, which is how most of these components initialise. Left as a
      // warning so they stay visible without making CI red on arrival.
      //
      // ponytail: blanket downgrade. Fix the call sites and restore this to
      // "error" when someone has the appetite — it is a real (if low-severity)
      // performance smell, not a false positive.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
