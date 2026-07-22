import { describe, expect, it } from "vitest"

import {
  boundsCenter,
  boundsSize,
  computeDimensionsMm,
  fitCameraToBounds,
} from "@/src/viewer/logic/geometry"
import type { Bounds } from "@/src/viewer/logic/types"

const unit: Bounds = { min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 3 } }

describe("boundsCenter / boundsSize", () => {
  it("computes the center", () => {
    expect(boundsCenter(unit)).toEqual({ x: 0, y: 0, z: 0 })
    expect(boundsCenter({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 } })).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("computes the size", () => {
    expect(boundsSize(unit)).toEqual({ x: 2, y: 4, z: 6 })
  })
})

describe("fitCameraToBounds", () => {
  it("targets the center and pulls back along the diagonal", () => {
    const { position, target } = fitCameraToBounds(unit, 50)
    expect(target).toEqual({ x: 0, y: 0, z: 0 })
    // Symmetric diagonal offset.
    expect(position.x).toBeCloseTo(position.y)
    expect(position.y).toBeCloseTo(position.z)
    expect(position.x).toBeGreaterThan(0)
  })

  it("pulls back further for a larger model", () => {
    const small = fitCameraToBounds({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, 50)
    const large = fitCameraToBounds({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }, 50)
    expect(large.position.x).toBeGreaterThan(small.position.x)
  })

  it("handles a degenerate (zero-size) model without dividing by zero", () => {
    const point: Bounds = { min: { x: 5, y: 5, z: 5 }, max: { x: 5, y: 5, z: 5 } }
    const { position, target } = fitCameraToBounds(point, 50)
    expect(target).toEqual({ x: 5, y: 5, z: 5 })
    expect(Number.isFinite(position.x)).toBe(true)
    expect(position.x).toBeGreaterThan(5)
  })

  it("respects a custom margin", () => {
    const tight = fitCameraToBounds(unit, 50, 1)
    const loose = fitCameraToBounds(unit, 50, 2)
    expect(loose.position.x).toBeGreaterThan(tight.position.x)
  })
})

describe("computeDimensionsMm", () => {
  it("scales the bounding size", () => {
    expect(computeDimensionsMm(unit, 1)).toEqual({ x: 2, y: 4, z: 6 })
    expect(computeDimensionsMm(unit, 10)).toEqual({ x: 20, y: 40, z: 60 })
  })
})
