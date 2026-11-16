import { describe, expect, it } from "vitest"

import {
  evaluateLandingBudget,
  formatBudgetReport,
  initialScriptPaths,
  isWithinBudget,
  LANDING_JS_BUDGET_BYTES,
  THREE_JS_MARKERS,
  type InitialScript,
} from "@/src/lib/landingBudget"

function script(over: Partial<InitialScript> = {}): InitialScript {
  return { path: "/_next/static/chunks/a.js", bytes: 1024, contents: "console.log(1)", ...over }
}

describe("initialScriptPaths", () => {
  it("reads every script the prerendered page loads, in order", () => {
    const html =
      '<html><body><script src="/_next/static/chunks/a.js" async></script>' +
      '<script src="/_next/static/chunks/b.js"></script></body></html>'
    expect(initialScriptPaths(html)).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
    ])
  })

  it("counts a chunk loaded twice only once", () => {
    const html = '<script src="/a.js"></script><script src="/a.js"></script>'
    expect(initialScriptPaths(html)).toEqual(["/a.js"])
  })

  it("ignores inline scripts, which carry no chunk to weigh", () => {
    expect(initialScriptPaths('<script>self.__next_f=[]</script>')).toEqual([])
  })

  it("finds nothing in a page with no scripts", () => {
    expect(initialScriptPaths("<html><body>hello</body></html>")).toEqual([])
  })
})

describe("evaluateLandingBudget", () => {
  it("adds up what the browser must fetch", () => {
    const report = evaluateLandingBudget([script({ bytes: 1000 }), script({ bytes: 2000 })])
    expect(report.totalBytes).toBe(3000)
    expect(report.scriptCount).toBe(2)
    expect(report.overBudgetBy).toBe(0)
  })

  it("reports how far over budget a bloated payload is", () => {
    const report = evaluateLandingBudget([script({ bytes: LANDING_JS_BUDGET_BYTES + 512 })])
    expect(report.overBudgetBy).toBe(512)
    expect(isWithinBudget(report)).toBe(false)
  })

  it("treats a payload exactly at the budget as within it", () => {
    const report = evaluateLandingBudget([script({ bytes: LANDING_JS_BUDGET_BYTES })])
    expect(report.overBudgetBy).toBe(0)
    expect(isWithinBudget(report)).toBe(true)
  })

  it.each(THREE_JS_MARKERS)("catches the viewer arriving, spotted by %s", (marker) => {
    const report = evaluateLandingBudget([
      script({ path: "/_next/static/chunks/viewer.js", contents: `class ${marker} {}` }),
    ])
    expect(report.threeScripts).toEqual([{ path: "/_next/static/chunks/viewer.js", marker }])
    expect(isWithinBudget(report)).toBe(false)
  })

  it("passes a small payload with no 3D in it", () => {
    expect(isWithinBudget(evaluateLandingBudget([script()]))).toBe(true)
  })

  it("passes an empty page", () => {
    const report = evaluateLandingBudget([])
    expect(report).toEqual({ totalBytes: 0, overBudgetBy: 0, scriptCount: 0, threeScripts: [] })
    expect(isWithinBudget(report)).toBe(true)
  })
})

describe("formatBudgetReport", () => {
  it("says so plainly when the page is within budget", () => {
    const report = evaluateLandingBudget([script({ bytes: 2048 })])
    expect(formatBudgetReport(report)).toContain("2.0 KiB across 1 scripts")
    expect(formatBudgetReport(report)).toContain("within budget")
  })

  it("names the overage", () => {
    const report = evaluateLandingBudget([script({ bytes: LANDING_JS_BUDGET_BYTES + 1024 })])
    expect(formatBudgetReport(report)).toContain("over budget by 1.0 KiB")
  })

  it("names the chunk that brought three.js in", () => {
    const report = evaluateLandingBudget([
      script({ path: "/_next/static/chunks/oops.js", contents: "new WebGLRenderer()" }),
    ])
    const formatted = formatBudgetReport(report)
    expect(formatted).toContain("/_next/static/chunks/oops.js carries three.js")
    expect(formatted).toContain("WebGLRenderer")
    expect(formatted).toContain("must stay deferred")
  })

  it("reports both problems at once", () => {
    const report = evaluateLandingBudget([
      script({ bytes: LANDING_JS_BUDGET_BYTES + 1, contents: "new PerspectiveCamera()" }),
    ])
    const formatted = formatBudgetReport(report)
    expect(formatted).toContain("over budget by")
    expect(formatted).toContain("carries three.js")
  })
})
