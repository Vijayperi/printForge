import { describe, expect, it } from "vitest"

import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { measure } from "@/src/domain/geometry/measure"
import { box, flip, rawFromTriangles } from "@/tests/helpers/geometry"

describe("measure — unit cube at 10 mm", () => {
  const mesh = buildIndexedMesh(rawFromTriangles(box([10, 10, 10])))
  const { measurements, findings } = measure(mesh, 1)

  it("reports the bounding box in mm", () => {
    expect(measurements.boundingMm).toEqual({ x: 10, y: 10, z: 10 })
  })

  it("reports volume 1 cm³ (1000 mm³)", () => {
    expect(measurements.volumeCm3).toBeCloseTo(1, 6)
  })

  it("reports surface area 6 cm² (600 mm²)", () => {
    expect(measurements.surfaceAreaCm2).toBeCloseTo(6, 6)
  })

  it("passes through triangle and component counts", () => {
    expect(measurements.triangleCount).toBe(12)
    expect(measurements.componentCount).toBe(1)
  })

  it("emits no empty_mesh finding", () => {
    expect(findings).toEqual([])
  })
})

describe("measure — orientation independence", () => {
  it("computes the same volume for an inward-wound cube", () => {
    const inward = box([10, 10, 10]).map(flip)
    const { measurements } = measure(buildIndexedMesh(rawFromTriangles(inward)), 1)
    expect(measurements.volumeCm3).toBeCloseTo(1, 6)
  })
})

describe("measure — non-cube dimensions", () => {
  it("reports asymmetric bounding and volume", () => {
    const mesh = buildIndexedMesh(rawFromTriangles(box([20, 10, 5], [1, 2, 3])))
    const { measurements } = measure(mesh, 1)
    expect(measurements.boundingMm).toEqual({ x: 20, y: 10, z: 5 })
    expect(measurements.volumeCm3).toBeCloseTo(1, 6) // 20·10·5 = 1000 mm³
  })
})

describe("measure — empty mesh", () => {
  const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
  const { measurements, findings } = measure(mesh, 0)

  it("reports zeroed measurements", () => {
    expect(measurements.boundingMm).toEqual({ x: 0, y: 0, z: 0 })
    expect(measurements.volumeCm3).toBe(0)
    expect(measurements.surfaceAreaCm2).toBe(0)
    expect(measurements.triangleCount).toBe(0)
  })

  it("emits an empty_mesh blocking finding", () => {
    expect(findings).toEqual([
      { kind: "empty_mesh", severity: "blocking", detail: "mesh contains no valid triangles" },
    ])
  })
})
