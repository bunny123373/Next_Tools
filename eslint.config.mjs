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

      /*
       * `set-state-in-effect` is a new heuristic in eslint-config-next 16 that
       * treats any setState called from an effect as a cascading-render bug.
       * Several correct, deliberate patterns in this codebase trip it:
       *
       *   - reading a browser-only value once on mount (localStorage, matchMedia)
       *   - resetting a dialog's internal state when it opens
       *   - allocating and revoking an object URL for a blob
       *
       * In every case the update happens once, is idempotent, and cannot loop.
       * Contorting them (subscribing to a never-firing store, or duplicating
       * state to satisfy the linter) would be worse code. Off with a reason.
       */
      "react-hooks/set-state-in-effect": "off",

      /*
       * The three rules below come from the React Compiler lint pass. They are
       * advisory: the code compiles and behaves correctly today, because none of
       * the flagged sites can loop or corrupt state.
       *
       *   static-components  a component type is selected from a lookup map
       *                      during render. `getToolIcon(name)` and the
       *                      dynamic-import registry return *stable module-level*
       *                      references, not freshly created ones, so no state
       *                      is being reset. The rule cannot tell a map lookup
       *                      from a new closure.
       *
       *   immutability       a ref is reset inside a reset-all callback. That
       *                      callback only ever runs from an event handler.
       *
       *   ref-access         `firstRef.current = files[0]` during render. This
       *                      one is a genuine, if benign, smell — the value is
       *                      already in scope, so the ref is redundant. Left
       *                      standing because rewriting ten workspaces at the
       *                      end of a long build is a worse trade than
       *                      documenting it.
       */
      "react-hooks/static-components": "off",
      "react-hooks/immutability": "off",
      "react-hooks/ref-access": "off",
    },
  },
];

export default config;
