import { describe, expect, it } from "vitest"

import { analyzeComponents } from "@/src/domain/geometry/components"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import type { Finding } from "@/src/domain/types"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

function analyze(triangles: number[][]) {
  return analyzeComponents(buildIndexedMesh(rawFromTriangles(triangles)))
}

describe("analyzeComponents — single body", () => {
  it("reports one component and no finding for a cube", () => {
    const result = analyze(box([10, 10, 10]))
    expect(result.componentCount).toBe(1)
    expect(result.findings).toEqual([])
  })
})

describe("analyzeComponents — disjoint bodies", () => {
  it("counts two separated cubes and flags multiple_components", () => {
    const two = [...box([10, 10, 10]), ...box([10, 10, 10], [100, 0, 0])]
    const result = analyze(two)
    expect(result.componentCount).toBe(2)
    expect(result.findings).toHaveLength(1)
    const finding = result.findings[0] as Finding
    expect(finding.kind).toBe("multiple_components")
    expect(finding.severity).toBe("info")
    expect(finding.count).toBe(2)
  })

  it("counts three separated bodies", () => {
    const three = [
      ...box([2, 2, 2]),
      ...box([2, 2, 2], [10, 0, 0]),
      ...box([2, 2, 2], [20, 0, 0]),
    ]
    expect(analyze(three).componentCount).toBe(3)
  })
})

describe("analyzeComponents — empty mesh", () => {
  it("reports zero components and no finding", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    const result = analyzeComponents(mesh)
    expect(result.componentCount).toBe(0)
    expect(result.findings).toEqual([])
  })
})
