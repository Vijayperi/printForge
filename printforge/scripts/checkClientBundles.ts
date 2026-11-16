/**
 * Fail the build if a server-only credential reached a client bundle
 * (plan §6-S15 step 5). Its logic lives in src/lib/bundleSecrets.ts (fully
 * covered); this file is just the filesystem walk.
 *
 * Runs as part of `npm run verify`, after `next build`:
 *   node --import tsx scripts/checkClientBundles.ts
 */
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  findSecretsInBundles,
  formatBundleFindings,
  secretNeedles,
  type BundleFile,
} from "@/src/lib/bundleSecrets"

/** Everything under `.next/static` is served to browsers verbatim. */
const CLIENT_DIR = ".next/static"

async function collect(dir: string, root: string): Promise<BundleFile[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: BundleFile[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collect(full, root)))
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".json")) {
      files.push({ path: path.relative(root, full), contents: await readFile(full, "utf8") })
    }
  }
  return files
}

async function main(): Promise<void> {
  let files: BundleFile[]
  try {
    files = await collect(CLIENT_DIR, CLIENT_DIR)
  } catch {
    console.error(`${CLIENT_DIR} not found — run \`next build\` before this check.`)
    process.exit(1)
  }

  const findings = findSecretsInBundles(files, secretNeedles(process.env))
  const report = formatBundleFindings(findings)
  if (findings.length > 0) {
    console.error(report)
    process.exit(1)
  }
  console.log(`${report} (${files.length} files scanned)`)
}

void main()
