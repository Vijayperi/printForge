import { describe, expect, it } from "vitest"

import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_PRINTER_PROFILE_ID,
  getMaterialProfile,
  getPrinterProfile,
  getQualityPreset,
  getStrengthPreset,
  materialProfiles,
  printerProfiles,
  qualityPresets,
  strengthPresets,
} from "@/src/config/profiles"

describe("printer profiles", () => {
  it("defaults to the Generic FDM profile with a 220×220×250 build volume", () => {
    const profile = getPrinterProfile()
    expect(profile.id).toBe(DEFAULT_PRINTER_PROFILE_ID)
    expect(profile.buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
    expect(profile.nozzleMm).toBe(0.4)
  })

  it("looks a profile up by id and falls back to the first for an unknown id", () => {
    expect(getPrinterProfile("generic-fdm").id).toBe("generic-fdm")
    expect(getPrinterProfile("nope").id).toBe(printerProfiles[0]!.id)
  })
})

describe("material profiles", () => {
  it("defaults to PLA with a positive min wall, density and price", () => {
    const material = getMaterialProfile()
    expect(material.id).toBe(DEFAULT_MATERIAL_ID)
    expect(material.minWallMm).toBeGreaterThan(0)
    expect(material.densityGCm3).toBeGreaterThan(0)
    expect(material.pricePerGramMinor).toBeGreaterThan(0)
  })

  it("exposes in-stock and out-of-stock colors", () => {
    const pla = getMaterialProfile("pla")
    expect(pla.colors.some((c) => c.inStock)).toBe(true)
    expect(pla.colors.some((c) => !c.inStock)).toBe(true)
  })

  it("falls back to the first material for an unknown id", () => {
    expect(getMaterialProfile("nope").id).toBe(materialProfiles[0]!.id)
    expect(getMaterialProfile("petg").id).toBe("petg")
  })
})

describe("quality and strength presets", () => {
  it("provides standard (0.2 mm) and fine (0.12 mm) quality", () => {
    expect(getQualityPreset("standard")?.layerHeightMm).toBe(0.2)
    expect(getQualityPreset("fine")?.layerHeightMm).toBe(0.12)
    expect(getQualityPreset("nope")).toBeUndefined()
    expect(qualityPresets).toHaveLength(2)
  })

  it("provides display/everyday/reinforced strength with rising infill", () => {
    expect(getStrengthPreset("display")?.infillPct).toBe(10)
    expect(getStrengthPreset("everyday")?.infillPct).toBe(25)
    expect(getStrengthPreset("reinforced")?.infillPct).toBe(50)
    expect(getStrengthPreset("nope")).toBeUndefined()
    expect(strengthPresets).toHaveLength(3)
  })
})
