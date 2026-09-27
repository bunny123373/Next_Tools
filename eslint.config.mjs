import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat ESLint config.
 *
 * Next 16 removed `next lint`, and `eslint-config-next` 16 now ships native
 * flat configs — so these are imported directly rather than bridged through
 * `FlatCompat`. (An earlier version of this file used FlatCompat, which
 * crashed with "Converting circular structure to JSON" against ESLint 9.39.)
 *
 * `npm run lint` invokes ESLint directly.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      // Generated asset, not app code.
      "public/sw.js",
      "scripts/**",
      // Throwaway typecheck/probe harnesses.
      "smoke*.ts",
      "**/*.diag.ts",
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Failures should be visible in the server log, not silent.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
];

export default config;
