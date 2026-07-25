import { describe, expect, it } from "vitest"

import { freezeConfiguration, readFrozenConfig } from "@/src/domain/checkout/frozenConfig"
import type { PrintConfigurationRow } from "@/src/domain/types"

const row: PrintConfigurationRow = {
  id: "cfg_1",
  design_version_id: "dv_1",
  material_id: "pla",
  color_id: "pla-white",
  dimensions_mm: { x: 10, y: 20, z: 30 },
  scale_factor: 1.5,
  quality_id: "standard",
  strength_id: "everyday",
  shipping_speed: "standard",
  special_instructions: "handle with care",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
}

describe("freezeConfiguration", () => {
  it("copies the whole configuration off the live row", () => {
    expect(freezeConfiguration(row)).toEqual({
      configurationId: "cfg_1",
      materialId: "pla",
      colorId: "pla-white",
      dimensionsMm: { x: 10, y: 20, z: 30 },
      scaleFactor: 1.5,
      qualityId: "standard",
      strengthId: "everyday",
      shippingSpeed: "standard",
      specialInstructions: "handle with care",
    })
  })
})

describe("readFrozenConfig", () => {
  it("round-trips a snapshot we wrote ourselves", () => {
    const frozen = freezeConfiguration(row)
    expect(readFrozenConfig({ ...frozen })).toEqual(frozen)
  })

  it("drops keys that were never part of the snapshot", () => {
    const frozen = readFrozenConfig({ ...freezeConfiguration(row), amountMinor: 999 })
    expect(frozen).not.toHaveProperty("amountMinor")
  })

  it("falls back rather than throwing on an empty snapshot", () => {
    expect(readFrozenConfig({})).toEqual({
      configurationId: "",
      materialId: "",
      colorId: "",
      dimensionsMm: null,
      scaleFactor: 1,
      qualityId: "",
      strengthId: "",
      shippingSpeed: "",
      specialInstructions: "",
    })
  })

  it("falls back on wrongly-typed fields", () => {
    const frozen = readFrozenConfig({
      materialId: 7,
      scaleFactor: "big",
      dimensionsMm: { x: "wide", y: 1, z: 1 },
    })
    expect(frozen.materialId).toBe("")
    expect(frozen.scaleFactor).toBe(1)
    expect(frozen.dimensionsMm).toBeNull()
  })
})
