import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Plan §6-S4: Supabase may only be imported inside the data layer (and the
// edge proxy). Everywhere else goes through src/data repositories.
const supabasePattern = {
  group: ["@supabase/*"],
  message:
    "Import Supabase only inside src/data/ (repositories) or proxy.ts. Elsewhere, call a repository from src/data.",
};

// Plan §6-S15 step 5: printers are unreachable from any browser context (FR-9),
// so the gateway is importable only from the worker and the ops release route.
const printerGatewayPattern = {
  group: ["@/src/adapters/printerGateway", "@/src/adapters/printerGateway/*"],
  message:
    "Import the printer gateway only from src/jobs/ or the ops release route. Elsewhere, read printer state from src/data/printers.",
};

/**
 * Flat config replaces a rule wholesale rather than merging it, so every
 * override below restates each ban that still applies to the files it matches.
 */
const restrictedImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    name: "printforge/import-boundaries",
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    rules: restrictedImports(supabasePattern, printerGatewayPattern),
  },
  {
    name: "printforge/import-boundaries-data",
    files: ["src/data/**/*.{ts,tsx}"],
    rules: restrictedImports(printerGatewayPattern),
  },
  {
    name: "printforge/import-boundaries-printer-gateway",
    files: [
      "src/jobs/**/*.ts",
      "src/adapters/printerGateway/**/*.ts",
      "app/api/ops/print-jobs/*/release/route.ts",
    ],
    rules: restrictedImports(supabasePattern),
  },
  {
    name: "printforge/unused-vars",
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "scripts/**/*.ts", "tests/**/*.{ts,tsx}"],
    rules: {
      // Allow intentionally-unused args/vars prefixed with underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
