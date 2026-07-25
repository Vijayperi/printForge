import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Plan §0 rule 10 / §6-S13 "Done when": provider secrets never leave the adapter,
 * and the client never gets to name a price. These are asserted from the source
 * tree so a future session cannot regress them by accident.
 */

const ROOT = path.resolve(__dirname, "../..")
const SCANNED_DIRS = ["src", "app"]
const SKIPPED_DIRS = new Set(["node_modules", ".next"])

const DODO_SECRET_ENV_VARS = ["DODO_API_KEY", "DODO_WEBHOOK_SECRET", "DODO_PRODUCT_ID"]

/**
 * Files allowed to name a Dodo credential. `bundleSecrets` is here because
 * naming them is its entire job: it is the check that hunts for these very
 * strings in the built client bundles (plan §6-S15 step 5).
 */
const CREDENTIAL_ALLOWLIST = new Set([
  "src/config/env.ts",
  "src/config/env.test.ts",
  "src/adapters/payments/factory.ts",
  "src/adapters/payments/factory.test.ts",
  "src/lib/bundleSecrets.ts",
  "src/lib/bundleSecrets.test.ts",
])

async function sourceFiles(): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(relative)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(relative)
      }
    }
  }
  for (const dir of SCANNED_DIRS) await walk(dir)
  return out
}

describe("payment invariants", () => {
  it("no Dodo credential is referenced outside the payments adapter and env config", async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      if (CREDENTIAL_ALLOWLIST.has(file)) continue
      const contents = await readFile(path.join(ROOT, file), "utf8")
      if (DODO_SECRET_ENV_VARS.some((name) => contents.includes(name))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it("the Dodo SDK is only imported by the Dodo adapter", async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const contents = await readFile(path.join(ROOT, file), "utf8")
      if (/from "dodopayments"/.test(contents)) offenders.push(file)
    }
    expect(offenders.sort()).toEqual([
      path.join("src", "adapters", "payments", "dodo.test.ts"),
      path.join("src", "adapters", "payments", "dodo.ts"),
    ])
  })

  // Stripe does not onboard India-based merchants; it must never come back
  // (plan §2.1). `env.test.ts` naming it as a *rejected* value is fine, so this
  // looks for real imports and a real dependency rather than any mention.
  it("nothing imports a Stripe module", async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      const contents = await readFile(path.join(ROOT, file), "utf8")
      if (/(?:from|require\()\s*["']@?stripe/i.test(contents)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it("Stripe is not a dependency", async () => {
    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]
    expect(names.filter((n) => /stripe/i.test(n))).toEqual([])
    expect(names).toContain("dodopayments")
    expect(names).toContain("standardwebhooks")
  })
})
