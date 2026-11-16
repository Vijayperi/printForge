/**
 * Fail the build if the landing page's initial JavaScript grows past its budget
 * or starts carrying the 3D viewer (plan §6-S16 step 3). Its logic lives in
 * src/lib/landingBudget.ts (fully covered); this file is just the filesystem
 * walk.
 *
 * Runs as part of `npm run verify`, after `next build`:
 *   node --import tsx scripts/checkLandingBudget.ts
 */
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import {
  evaluateLandingBudget,
  formatBudgetReport,
  initialScriptPaths,
  isWithinBudget,
  type InitialScript,
} from "@/src/lib/landingBudget"

/**
 * The prerendered landing page. Its absence is itself a regression: the landing
 * page is static by design, and a dynamic one cannot hit the performance target
 * no matter how small its bundle is.
 */
const LANDING_HTML = ".next/server/app/index.html"

/** `/_next/static/chunks/x.js` as the browser requests it → the file on disk. */
function toDiskPath(src: string): string | null {
  const prefix = "/_next/"
  return src.startsWith(prefix) ? path.join(".next", src.slice(prefix.length)) : null
}

async function main(): Promise<void> {
  let html: string
  try {
    html = await readFile(LANDING_HTML, "utf8")
  } catch {
    console.error(
      `${LANDING_HTML} not found — run \`next build\` first, and check the landing page is still statically prerendered.`
    )
    process.exit(1)
  }

  const scripts: InitialScript[] = []
  for (const src of initialScriptPaths(html)) {
    const diskPath = toDiskPath(src)
    // Anything not served from /_next is a third-party script the budget does
    // not own; there are none today, and one appearing is a review question.
    if (diskPath === null) continue
    scripts.push({
      path: src,
      bytes: (await stat(diskPath)).size,
      contents: await readFile(diskPath, "utf8"),
    })
  }

  const report = evaluateLandingBudget(scripts)
  const formatted = formatBudgetReport(report)
  if (!isWithinBudget(report)) {
    console.error(formatted)
    process.exit(1)
  }
  console.log(formatted)
}

void main()
