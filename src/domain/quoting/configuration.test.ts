import { describe, expect, it } from "vitest"

import {
  materialProfiles,
  printerProfiles,
  qualityPresets,
  SHIPPING_SPEEDS,
  strengthPresets,
} from "@/src/config/profiles"
import {
  applyScale,
  longestDim,
  MAX_INSTRUCTIONS,
  MIN_LONGEST_MM,
  scaleHash,
  validateConfiguration,
  type ConfigCatalog,
  type ConfigViolationCode,
  type PrintConfigInput,
} from "@/src/domain/quoting/configuration"

const CATALOG: ConfigCatalog = {
  profile: printerProfiles[0]!,
  materials: materialProfiles,
  qualities: qualityPresets,
  strengths: strengthPresets,
  shippingSpeeds: SHIPPING_SPEEDS,
}

// A valid baseline (PLA / white, comfortably inside the 220×220×250 volume).
function validInput(over: Partial<PrintConfigInput> = {}): PrintConfigInput {
  return {
    materialId: "pla",
    colorId: "pla-white",
    dimensionsMm: { x: 50, y: 50, z: 50 },
    scaleFactor: 1,
    qualityId: "standard",
    strengthId: "everyday",
    shippingSpeed: "standard",
    specialInstructions: "",
    ...over,
  }
}

function codes(input: PrintConfigInput): ConfigViolationCode[] {
  const result = validateConfiguration(input, CATALOG)
  return result.ok ? [] : result.error.map((v) => v.code)
}

describe("longestDim", () => {
  it("returns the largest axis regardless of order", () => {
    expect(longestDim({ x: 3, y: 9, z: 5 })).toBe(9)
    expect(longestDim({ x: 12, y: 1, z: 4 })).toBe(12)
    expect(longestDim({ x: 2, y: 2, z: 8 })).toBe(8)
  })
})

describe("applyScale", () => {
  it("scales uniformly so the longest edge hits the target", () => {
    const { dims, scaleFactor } = applyScale({ x: 20, y: 10, z: 40 }, 80)
    expect(scaleFactor).toBe(2)
    expect(dims).toEqual({ x: 40, y: 20, z: 80 })
  })

  it("handles shrinking below the base size", () => {
    const { dims, scaleFactor } = applyScale({ x: 100, y: 50, z: 25 }, 50)
    expect(scaleFactor).toBe(0.5)
    expect(dims).toEqual({ x: 50, y: 25, z: 12.5 })
  })

  it("returns scaleFactor 0 for a degenerate (zero-size) base instead of dividing by zero", () => {
    const { dims, scaleFactor } = applyScale({ x: 0, y: 0, z: 0 }, 40)
    expect(scaleFactor).toBe(0)
    expect(dims).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe("scaleHash", () => {
  it("is non-empty and stable per scale", () => {
    expect(scaleHash(1)).toBe("s1")
    expect(scaleHash(1.5)).toBe("s1.5")
    expect(scaleHash(2)).toBe("s2")
  })

  it("rounds float noise to a single key (6 dp)", () => {
    expect(scaleHash(1 / 3)).toBe("s0.333333")
    expect(scaleHash(0.3333331)).toBe("s0.333333")
  })

  it("distinguishes different scales", () => {
    expect(scaleHash(1)).not.toBe(scaleHash(1.0001))
  })
})

describe("validateConfiguration — happy path", () => {
  it("accepts a valid configuration and returns the input unchanged", () => {
    const input = validInput()
    const result = validateConfiguration(input, CATALOG)
    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toBe(input)
  })
})

describe("validateConfiguration — scale", () => {
  it("rejects a zero scale", () => {
    expect(codes(validInput({ scaleFactor: 0 }))).toContain("invalid_scale")
  })
  it("rejects a negative scale", () => {
    expect(codes(validInput({ scaleFactor: -1 }))).toContain("invalid_scale")
  })
  it("rejects a non-finite scale", () => {
    expect(codes(validInput({ scaleFactor: Number.NaN }))).toContain("invalid_scale")
    expect(codes(validInput({ scaleFactor: Number.POSITIVE_INFINITY }))).toContain("invalid_scale")
  })
})

describe("validateConfiguration — material & colour", () => {
  it("rejects an unknown material (and cannot check its colour)", () => {
    const c = codes(validInput({ materialId: "titanium", colorId: "pla-white" }))
    expect(c).toContain("unknown_material")
    expect(c).not.toContain("unknown_color")
  })
  it("rejects a colour that does not belong to the material", () => {
    expect(codes(validInput({ colorId: "petg-clear" }))).toContain("unknown_color")
  })
  it("rejects an out-of-stock colour", () => {
    expect(codes(validInput({ colorId: "pla-slate" }))).toContain("color_out_of_stock")
  })
  it("accepts an in-stock colour of the chosen material", () => {
    expect(codes(validInput({ materialId: "petg", colorId: "petg-clear" }))).toEqual([])
  })
})

describe("validateConfiguration — presets & shipping", () => {
  it("rejects an unknown quality", () => {
    expect(codes(validInput({ qualityId: "ultra" }))).toContain("unknown_quality")
  })
  it("rejects an unknown strength", () => {
    expect(codes(validInput({ strengthId: "titanium" }))).toContain("unknown_strength")
  })
  it("rejects an unknown shipping speed", () => {
    expect(codes(validInput({ shippingSpeed: "teleport" }))).toContain("unknown_shipping")
  })
  it("accepts express shipping", () => {
    expect(codes(validInput({ shippingSpeed: "express" }))).toEqual([])
  })
})

describe("validateConfiguration — size boundaries", () => {
  it("accepts exactly the minimum longest edge", () => {
    expect(codes(validInput({ dimensionsMm: { x: MIN_LONGEST_MM, y: 5, z: 5 } }))).toEqual([])
  })
  it("rejects just below the minimum longest edge", () => {
    expect(codes(validInput({ dimensionsMm: { x: MIN_LONGEST_MM - 0.01, y: 5, z: 5 } }))).toContain(
      "too_small"
    )
  })
  it("accepts dimensions exactly at the build volume", () => {
    expect(codes(validInput({ dimensionsMm: { x: 220, y: 220, z: 250 } }))).toEqual([])
  })
  it("rejects when any axis exceeds the build volume", () => {
    expect(codes(validInput({ dimensionsMm: { x: 220.1, y: 10, z: 10 } }))).toContain(
      "exceeds_build_volume"
    )
    expect(codes(validInput({ dimensionsMm: { x: 10, y: 10, z: 250.1 } }))).toContain(
      "exceeds_build_volume"
    )
  })
})

describe("validateConfiguration — instructions", () => {
  it("accepts instructions at the length cap", () => {
    expect(codes(validInput({ specialInstructions: "x".repeat(MAX_INSTRUCTIONS) }))).toEqual([])
  })
  it("rejects instructions over the cap", () => {
    expect(codes(validInput({ specialInstructions: "x".repeat(MAX_INSTRUCTIONS + 1) }))).toContain(
      "instructions_too_long"
    )
  })
})

describe("validateConfiguration — accumulation", () => {
  it("reports every violation at once, each tagged with its UI field", () => {
    const result = validateConfiguration(
      {
        materialId: "unknown",
        colorId: "nope",
        dimensionsMm: { x: 1, y: 1, z: 999 },
        scaleFactor: 0,
        qualityId: "nope",
        strengthId: "nope",
        shippingSpeed: "nope",
        specialInstructions: "x".repeat(MAX_INSTRUCTIONS + 1),
      },
      CATALOG
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const byField = result.error.map((v) => `${v.field}:${v.code}`)
    expect(byField).toEqual(
      expect.arrayContaining([
        "size:invalid_scale",
        "material:unknown_material",
        "quality:unknown_quality",
        "strength:unknown_strength",
        "shipping:unknown_shipping",
        "size:exceeds_build_volume",
        "instructions:instructions_too_long",
      ])
    )
    // Every violation carries a human-readable message.
    expect(result.error.every((v) => v.message.length > 0)).toBe(true)
  })
})
