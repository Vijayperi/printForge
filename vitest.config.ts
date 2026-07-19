import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: false,
    include: [
      "app/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
      // Allowed exclusions per implementation plan §5.1 ONLY. Do not extend
      // this list without a DECISIONS.md entry.
      exclude: ["**/*.d.ts", "**/*.test.{ts,tsx}", "**/*.spec-factory.ts", "app/layout.tsx"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
