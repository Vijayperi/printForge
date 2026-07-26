import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { CLIENT_FORBIDDEN_ENV_KEYS } from "@/src/lib/bundleSecrets"
import { RATE_LIMITS } from "@/src/lib/rateLimit"

/**
 * The PRD §10 security posture, asserted from the source tree (plan §6-S16
 * step 2). Behaviour is tested where it lives; these are the structural rules
 * that a later session could otherwise undo without any test going red —
 * an unthrottled endpoint, a signed URL that outlives its page, an upload route
 * that forgets to scan, a new credential nobody added to the bundle grep.
 */

const ROOT = path.resolve(__dirname, "../..")
const SCANNED_DIRS = ["src", "app"]
const SKIPPED_DIRS = new Set(["node_modules", ".next"])

/** PRD §10: "private object storage with short-lived signed URLs". */
const MAX_SIGNED_URL_TTL_SECONDS = 600

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

async function productionFiles(): Promise<string[]> {
  return (await sourceFiles()).filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
}

function read(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8")
}

describe("rate limits", () => {
  it("covers every endpoint the PRD names: auth, generation, upload", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toEqual([
      "auth",
      "authNetwork",
      "generation",
      "upload",
    ])
  })

  it("uses the limits plan §6-S16 step 2 specifies", () => {
    expect(RATE_LIMITS.auth).toEqual({ limit: 10, windowSeconds: 900 })
    expect(RATE_LIMITS.generation).toEqual({ limit: 5, windowSeconds: 3600 })
    expect(RATE_LIMITS.upload).toEqual({ limit: 10, windowSeconds: 3600 })
  })

  // The per-network bucket exists to bound spraying, not to police households:
  // keying the tight limit on IP would throttle everyone behind one NAT.
  it("keeps the per-network limit far looser than the per-account one", () => {
    expect(RATE_LIMITS.authNetwork.windowSeconds).toBe(RATE_LIMITS.auth.windowSeconds)
    expect(RATE_LIMITS.authNetwork.limit).toBeGreaterThan(RATE_LIMITS.auth.limit * 5)
  })

  it("is applied at each of those three surfaces", async () => {
    const throttled = new Map<string, string>([
      ["auth", path.join("app", "(auth)", "actions.ts")],
      ["generation", path.join("app", "api", "projects", "[id]", "generations", "route.ts")],
      ["upload", path.join("app", "api", "uploads", "stl", "route.ts")],
    ])
    for (const [scope, file] of throttled) {
      const contents = await read(file)
      expect(contents, `${file} must enforce the ${scope} rate limit`).toContain(
        `enforceRateLimit(`
      )
      expect(contents, `${file} must enforce the ${scope} scope`).toContain(`"${scope}"`)
    }
  })

  // The webhook is deliberately unthrottled: its signature is the gate, and
  // throttling a payment provider's retries would drop money on the floor.
  it("does not throttle the payment webhook", async () => {
    const webhook = await read(path.join("app", "api", "webhooks", "dodo", "route.ts"))
    expect(webhook).not.toContain("enforceRateLimit")
  })
})

describe("signed urls", () => {
  it("are never minted for longer than ten minutes", async () => {
    const offenders: string[] = []
    for (const file of await productionFiles()) {
      const contents = await read(file)
      // Only call sites pass a literal TTL; the interface and the two impls
      // take it as a parameter and are matched by the `ttlSeconds` name.
      for (const match of contents.matchAll(/getSignedUrl\([^)]*?,\s*(\d[\d_]*)\s*\)/g)) {
        const ttl = Number((match[1] ?? "0").replaceAll("_", ""))
        if (ttl > MAX_SIGNED_URL_TTL_SECONDS) offenders.push(`${file}: ${ttl}s`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("is reached only through the ownership-checked asset route", async () => {
    const callers: string[] = []
    for (const file of await productionFiles()) {
      if (file.startsWith(path.join("src", "adapters", "storage"))) continue
      if ((await read(file)).includes("getSignedUrl(")) callers.push(file)
    }
    expect(callers).toEqual([path.join("app", "api", "assets", "[id]", "route.ts")])
  })
})

describe("upload scanning", () => {
  it("happens on every route that reads uploaded bytes", async () => {
    const unscanned: string[] = []
    for (const file of await productionFiles()) {
      if (!file.startsWith(path.join("app", "api"))) continue
      const contents = await read(file)
      // A route that pulls a file out of a multipart form is handling bytes we
      // did not produce; PRD §10 says those are scanned before processing.
      if (!contents.includes("request.formData()")) continue
      if (!contents.includes("getUploadScanner()")) unscanned.push(file)
    }
    expect(unscanned).toEqual([])
  })
})

describe("client bundle secrets", () => {
  it("covers every server-only credential in the env schema", async () => {
    const env = await read(path.join("src", "config", "env.ts"))
    // Every env var whose name ends in a secret-ish suffix must be in the grep
    // list, so adding a credential without guarding it fails here.
    const declared = [...env.matchAll(/^\s{4}([A-Z0-9_]*(?:KEY|SECRET|CONFIG)):/gm)].map(
      ([, name]) => name as string
    )
    const publicByDesign = declared.filter((name) => name.startsWith("NEXT_PUBLIC_"))
    const shouldBeGuarded = declared.filter((name) => !name.startsWith("NEXT_PUBLIC_"))

    expect(publicByDesign).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"])
    expect([...shouldBeGuarded].sort()).toEqual([...CLIENT_FORBIDDEN_ENV_KEYS].sort())
  })
})

describe("auth csrf posture", () => {
  // Server actions carry Next's own action id and origin check; a hand-rolled
  // fetch to a POST endpoint would not, so the auth surface must have none.
  it("mutates only through server actions, never a client fetch", async () => {
    const offenders: string[] = []
    for (const file of await productionFiles()) {
      if (!file.startsWith(path.join("app", "(auth)"))) continue
      if (/\bfetch\(/.test(await read(file))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it("has no auth API route that could be posted to cross-site", async () => {
    const authRoutes = (await productionFiles()).filter(
      (file) => file.startsWith(path.join("app", "api", "auth")) && file.endsWith("route.ts")
    )
    expect(authRoutes).toEqual([])
  })
})
