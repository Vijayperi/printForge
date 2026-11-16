/**
 * The landing page's JavaScript budget (plan §6-S16 step 3, PRD §10 performance).
 *
 * The PRD's target is a Lighthouse mobile score, which needs a deployed URL and
 * a real device profile; what CI can assert deterministically is the thing that
 * *decides* that score for this page — how much JavaScript the browser must
 * fetch before it can render, and specifically that the 3D viewer is not part
 * of it. A Lighthouse run against a deployed environment is a launch step
 * (see LAUNCH_CHECKLIST.md); this is the regression gate that runs every build.
 */

/**
 * Raw (pre-compression) bytes of the landing route's initial scripts. Chosen
 * with headroom over the current figure: it is not a hair-shirt limit, it is a
 * tripwire for a whole library arriving by accident.
 */
export const LANDING_JS_BUDGET_BYTES = 800 * 1024

/**
 * Strings that only appear in a bundled three.js. The landing page shows no 3D
 * — the viewer lives behind the studio routes — so finding any of these in the
 * initial payload means the dynamic import that defers it has been broken.
 */
export const THREE_JS_MARKERS = ["WebGLRenderer", "PerspectiveCamera", "BufferGeometry"] as const

export interface InitialScript {
  path: string
  bytes: number
  contents: string
}

export interface BudgetReport {
  totalBytes: number
  overBudgetBy: number
  scriptCount: number
  /** Scripts that carry three.js, with the marker that gave them away. */
  threeScripts: { path: string; marker: string }[]
}

/**
 * The scripts the browser loads before it can paint, read straight out of the
 * prerendered HTML — the same list a browser would build.
 */
export function initialScriptPaths(html: string): string[] {
  const paths: string[] = []
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = match[1]
    if (src !== undefined && !paths.includes(src)) paths.push(src)
  }
  return paths
}

/** Weigh the landing payload and look for the viewer in it. */
export function evaluateLandingBudget(scripts: readonly InitialScript[]): BudgetReport {
  const totalBytes = scripts.reduce((sum, script) => sum + script.bytes, 0)
  const threeScripts: { path: string; marker: string }[] = []
  for (const script of scripts) {
    const marker = THREE_JS_MARKERS.find((needle) => script.contents.includes(needle))
    if (marker !== undefined) threeScripts.push({ path: script.path, marker })
  }
  return {
    totalBytes,
    overBudgetBy: Math.max(0, totalBytes - LANDING_JS_BUDGET_BYTES),
    scriptCount: scripts.length,
    threeScripts,
  }
}

export function isWithinBudget(report: BudgetReport): boolean {
  return report.overBudgetBy === 0 && report.threeScripts.length === 0
}

/** A build-log-friendly summary of the report. */
export function formatBudgetReport(report: BudgetReport): string {
  const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`
  const headline =
    `landing initial JS: ${kib(report.totalBytes)} across ${report.scriptCount} scripts ` +
    `(budget ${kib(LANDING_JS_BUDGET_BYTES)})`

  if (isWithinBudget(report)) return `${headline} — within budget, no 3D in the initial payload`

  const lines = [headline]
  if (report.overBudgetBy > 0) lines.push(`  over budget by ${kib(report.overBudgetBy)}`)
  for (const { path, marker } of report.threeScripts) {
    lines.push(`  ${path} carries three.js (found "${marker}") — the viewer must stay deferred`)
  }
  return lines.join("\n")
}
