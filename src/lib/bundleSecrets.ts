/**
 * The client-bundle secret check (plan §6-S15 step 5, PRD invariant §0.10).
 *
 * Server-only credentials must never reach a browser. `import "server-only"` and
 * the ESLint boundaries are how that is *arranged*; this is how it is *verified* —
 * the built client bundles are searched for both the names of the forbidden env
 * vars (which appear when client code reads `process.env.X`) and, when they are
 * set, their actual values (which appear when a secret is inlined or leaked
 * through a prop). A hit fails the build.
 */

/** Credentials that may only ever exist on the server. */
export const CLIENT_FORBIDDEN_ENV_KEYS = [
  "PRINTER_GATEWAY_CONFIG",
  "DODO_API_KEY",
  "MESHY_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const

/**
 * Values shorter than this are not searched for: a placeholder like `mock` or
 * `1` would match half the bundle and say nothing about a leak.
 */
export const MIN_SEARCHABLE_VALUE_LENGTH = 12

export interface SecretNeedle {
  /** What to report when this is found — never the secret itself. */
  label: string
  needle: string
}

export interface BundleFile {
  path: string
  contents: string
}

export interface BundleFinding {
  file: string
  label: string
}

/** What to search the bundles for, given the environment the build ran in. */
export function secretNeedles(env: Record<string, string | undefined>): SecretNeedle[] {
  const needles: SecretNeedle[] = []
  for (const key of CLIENT_FORBIDDEN_ENV_KEYS) {
    needles.push({ label: `the name ${key}`, needle: key })
    const value = env[key]
    if (value !== undefined && value.length >= MIN_SEARCHABLE_VALUE_LENGTH) {
      needles.push({ label: `the value of ${key}`, needle: value })
    }
  }
  return needles
}

/** Every (file, needle) hit across the built client bundles. */
export function findSecretsInBundles(
  files: readonly BundleFile[],
  needles: readonly SecretNeedle[]
): BundleFinding[] {
  const findings: BundleFinding[] = []
  for (const file of files) {
    for (const { label, needle } of needles) {
      if (file.contents.includes(needle)) findings.push({ file: file.path, label })
    }
  }
  return findings
}

/** A build-log-friendly report. Never prints a secret, only which one it was. */
export function formatBundleFindings(findings: readonly BundleFinding[]): string {
  if (findings.length === 0) return "client bundles carry no server-only secrets"
  const lines = findings.map((finding) => `  ${finding.file}: ${finding.label}`)
  return [
    `server-only secrets found in ${findings.length} place(s) in the client bundle:`,
    ...lines,
    "Move the code that reads them into a server module (see AGENTS.md).",
  ].join("\n")
}
