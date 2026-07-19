import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const supabaseImportBan = {
  name: "printforge/no-supabase-outside-data",
  rules: {
    // Plan §6-S4: Supabase may only be imported inside the data layer (and the
    // edge proxy). Everywhere else goes through src/data repositories.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@supabase/*"],
            message:
              "Import Supabase only inside src/data/ (repositories) or proxy.ts. Elsewhere, call a repository from src/data.",
          },
        ],
      },
    ],
  },
};

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
    ...supabaseImportBan,
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/data/**"],
  },
]);

export default eslintConfig;
