import { describe, expect, it } from "vitest"

import {
  CLIENT_FORBIDDEN_ENV_KEYS,
  findSecretsInBundles,
  formatBundleFindings,
  MIN_SEARCHABLE_VALUE_LENGTH,
  secretNeedles,
} from "@/src/lib/bundleSecrets"

describe("secretNeedles", () => {
  it("always searches for the name of every forbidden key", () => {
    const needles = secretNeedles({})
    expect(needles.map((n) => n.needle)).toEqual([...CLIENT_FORBIDDEN_ENV_KEYS])
  })

  it("also searches for a set value", () => {
    const value = "dodo-live-key-abcdef123456"
    const needles = secretNeedles({ DODO_API_KEY: value })
    expect(needles).toContainEqual({ label: "the value of DODO_API_KEY", needle: value })
  })

  it("ignores values too short to mean anything", () => {
    const short = "x".repeat(MIN_SEARCHABLE_VALUE_LENGTH - 1)
    const needles = secretNeedles({ MESHY_API_KEY: short })
    expect(needles.some((n) => n.needle === short)).toBe(false)
  })
})

describe("findSecretsInBundles", () => {
  const needles = secretNeedles({ DODO_API_KEY: "dodo-live-key-abcdef123456" })

  it("finds nothing in a clean bundle", () => {
    const files = [{ path: "chunks/page.js", contents: "console.log('hello')" }]
    expect(findSecretsInBundles(files, needles)).toEqual([])
  })

  it("reports a leaked value and names the key, not the secret", () => {
    const files = [{ path: "chunks/leak.js", contents: 'const k="dodo-live-key-abcdef123456"' }]
    expect(findSecretsInBundles(files, needles)).toEqual([
      { file: "chunks/leak.js", label: "the value of DODO_API_KEY" },
    ])
  })

  it("reports client code that reads a server-only env var", () => {
    const files = [{ path: "chunks/oops.js", contents: "process.env.PRINTER_GATEWAY_CONFIG" }]
    expect(findSecretsInBundles(files, needles)).toEqual([
      { file: "chunks/oops.js", label: "the name PRINTER_GATEWAY_CONFIG" },
    ])
  })

  it("reports every hit across every file", () => {
    const files = [
      { path: "a.js", contents: "MESHY_API_KEY" },
      { path: "b.js", contents: "SUPABASE_SERVICE_ROLE_KEY and DODO_API_KEY" },
    ]
    expect(findSecretsInBundles(files, needles)).toHaveLength(3)
  })
})

describe("formatBundleFindings", () => {
  it("says so when the bundles are clean", () => {
    expect(formatBundleFindings([])).toBe("client bundles carry no server-only secrets")
  })

  it("lists each hit with its file", () => {
    const report = formatBundleFindings([{ file: "a.js", label: "the name DODO_API_KEY" }])
    expect(report).toContain("found in 1 place(s)")
    expect(report).toContain("  a.js: the name DODO_API_KEY")
    expect(report).toContain("AGENTS.md")
  })
})
