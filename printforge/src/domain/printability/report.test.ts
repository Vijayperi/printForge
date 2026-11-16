import { describe, expect, it } from "vitest"

import { getMaterialProfile, getPrinterProfile } from "@/src/config/profiles"
import { buildReport } from "@/src/domain/printability/report"
import type { Finding, FindingKind, Measurements, Verdict } from "@/src/domain/types"

const PROFILE = getPrinterProfile() // build volume 220×220×250
const MATERIAL = getMaterialProfile() // PLA, minWall 0.8

function measurements(over: Partial<Measurements> = {}): Measurements {
  return {
    boundingMm: { x: 10, y: 10, z: 10 },
    volumeCm3: 1,
    surfaceAreaCm2: 6,
    triangleCount: 12,
    componentCount: 1,
    smallestComponentVolumeFraction: 1,
    ...over,
  }
}

function finding(kind: FindingKind, over: Partial<Finding> = {}): Finding {
  return { kind, severity: "warning", detail: kind, ...over }
}

function verdictOf(
  findings: Finding[],
  m: Measurements = measurements(),
  scale = 1
): Verdict {
  return buildReport(findings, m, PROFILE, MATERIAL, scale).verdict
}

describe("buildReport — pass", () => {
  it("passes a clean model within the build volume", () => {
    expect(verdictOf([])).toBe("pass")
  })
})

describe("buildReport — fail tier", () => {
  it("fails on empty_mesh", () => {
    expect(verdictOf([finding("empty_mesh", { severity: "blocking" })])).toBe("fail")
  })

  it("fails when a scaled dimension exceeds the build volume, not at the exact boundary", () => {
    expect(verdictOf([], measurements({ boundingMm: { x: 220, y: 10, z: 10 } }))).toBe("pass")
    expect(verdictOf([], measurements({ boundingMm: { x: 220.1, y: 10, z: 10 } }))).toBe("fail")
    // scaleFactor multiplies the model before the check
    expect(verdictOf([], measurements({ boundingMm: { x: 100, y: 10, z: 10 } }), 3)).toBe("fail")
    // ...and each axis is checked independently
    expect(verdictOf([], measurements({ boundingMm: { x: 10, y: 10, z: 260 } }))).toBe("fail")
  })

  it("adds an exceeds_build_volume finding when oversized", () => {
    const report = buildReport([], measurements({ boundingMm: { x: 300, y: 10, z: 10 } }), PROFILE, MATERIAL, 1)
    expect(report.findings.map((f) => f.kind)).toContain("exceeds_build_volume")
  })

  it("fails on a blocking self-intersection with a positive count", () => {
    expect(verdictOf([finding("self_intersections", { severity: "blocking", count: 3 })])).toBe("fail")
  })

  it("does not fail a self_intersection at non-blocking severity or zero count", () => {
    expect(verdictOf([finding("self_intersections", { severity: "warning", count: 5 })])).toBe("pass")
    expect(verdictOf([finding("self_intersections", { severity: "blocking" })])).toBe("pass") // count ?? 0
  })

  it("fails boundary_holes above the edge threshold, manual-reviews at or below it", () => {
    expect(verdictOf([finding("boundary_holes", { count: 101 })])).toBe("fail")
    expect(verdictOf([finding("boundary_holes", { count: 100 })])).toBe("manual_review")
    expect(verdictOf([finding("boundary_holes", { count: 4 })])).toBe("manual_review")
    expect(verdictOf([finding("boundary_holes")])).toBe("manual_review") // count ?? 0
  })
})

describe("buildReport — manual_review tier", () => {
  it("manual-reviews non_manifold_edges", () => {
    expect(verdictOf([finding("non_manifold_edges", { count: 2 })])).toBe("manual_review")
  })

  it("manual-reviews inverted_normals", () => {
    expect(verdictOf([finding("inverted_normals")])).toBe("manual_review")
  })

  it("manual-reviews trapped_volume", () => {
    expect(verdictOf([finding("trapped_volume")])).toBe("manual_review")
  })

  it("manual-reviews multiple_components only when a component is below 5% volume", () => {
    const comp = [finding("multiple_components", { count: 2 })]
    expect(verdictOf(comp, measurements({ componentCount: 2, smallestComponentVolumeFraction: 0.049 }))).toBe("manual_review")
    expect(verdictOf(comp, measurements({ componentCount: 2, smallestComponentVolumeFraction: 0.05 }))).toBe("warning")
    expect(verdictOf(comp, measurements({ componentCount: 2, smallestComponentVolumeFraction: 0.051 }))).toBe("warning")
  })

  it("manual-reviews a thin wall below the material minimum, not at the boundary", () => {
    expect(verdictOf([], measurements({ boundingMm: { x: 10, y: 10, z: 0.8 } }))).toBe("pass")
    expect(verdictOf([], measurements({ boundingMm: { x: 10, y: 10, z: 0.79 } }))).toBe("manual_review")
  })

  it("manual-reviews unstable_base", () => {
    expect(verdictOf([finding("unstable_base")])).toBe("manual_review")
  })
})

describe("buildReport — warning tier", () => {
  it("warns on unsupported_overhang", () => {
    expect(verdictOf([finding("unsupported_overhang", { count: 40 })])).toBe("warning")
  })

  it("warns on multiple_components with all components ≥ 5% volume", () => {
    expect(
      verdictOf([finding("multiple_components", { count: 2 })], measurements({ componentCount: 2, smallestComponentVolumeFraction: 0.4 }))
    ).toBe("warning")
  })

  it("warns on degenerate_geometry", () => {
    expect(verdictOf([finding("degenerate_geometry", { count: 1 })])).toBe("warning")
  })
})

describe("buildReport — precedence", () => {
  it("fail outranks manual_review", () => {
    expect(verdictOf([finding("empty_mesh", { severity: "blocking" }), finding("non_manifold_edges")])).toBe("fail")
  })

  it("manual_review outranks warning", () => {
    expect(verdictOf([finding("inverted_normals"), finding("unsupported_overhang")])).toBe("manual_review")
  })

  it("warning outranks pass", () => {
    expect(verdictOf([finding("degenerate_geometry", { count: 1 })])).toBe("warning")
  })

  it("returns the full merged finding list alongside the verdict", () => {
    const report = buildReport([finding("degenerate_geometry", { count: 1 })], measurements(), PROFILE, MATERIAL, 1)
    expect(report.verdict).toBe("warning")
    expect(report.findings.map((f) => f.kind)).toEqual(["degenerate_geometry"])
  })
})
