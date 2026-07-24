import { describe, expect, it } from "vitest"

import {
  configHashFromRow,
  isExpired,
  quoteConfigHash,
  quoteExpiresAt,
  QUOTE_TTL_MS,
  type QuotePricingInput,
} from "@/src/domain/quoting/quote"
import type { PrintConfigurationRow } from "@/src/domain/types"

const base: QuotePricingInput = {
  scaleFactor: 1,
  materialId: "pla",
  qualityId: "standard",
  strengthId: "everyday",
  shippingSpeed: "standard",
}

describe("quoteConfigHash", () => {
  it("is stable for identical inputs", () => {
    expect(quoteConfigHash(base)).toBe(quoteConfigHash({ ...base }))
  })

  it("changes when any pricing-relevant field changes", () => {
    const h = quoteConfigHash(base)
    expect(quoteConfigHash({ ...base, scaleFactor: 2 })).not.toBe(h)
    expect(quoteConfigHash({ ...base, materialId: "petg" })).not.toBe(h)
    expect(quoteConfigHash({ ...base, qualityId: "fine" })).not.toBe(h)
    expect(quoteConfigHash({ ...base, strengthId: "reinforced" })).not.toBe(h)
    expect(quoteConfigHash({ ...base, shippingSpeed: "express" })).not.toBe(h)
  })

  it("rounds the scale factor to 6 dp", () => {
    expect(quoteConfigHash({ ...base, scaleFactor: 1 / 3 })).toBe(
      quoteConfigHash({ ...base, scaleFactor: 0.3333331 })
    )
  })
})

describe("configHashFromRow", () => {
  const row = (over: Partial<PrintConfigurationRow> = {}): PrintConfigurationRow =>
    ({
      id: "cfg_1",
      design_version_id: "dv_1",
      material_id: "pla",
      color_id: "pla-white",
      dimensions_mm: { x: 10, y: 10, z: 10 },
      scale_factor: 1,
      quality_id: "standard",
      strength_id: "everyday",
      shipping_speed: "standard",
      special_instructions: "",
      created_at: "1",
      updated_at: "1",
      ...over,
    }) as PrintConfigurationRow

  it("matches quoteConfigHash for the same fields", () => {
    expect(configHashFromRow(row())).toBe(quoteConfigHash(base))
  })

  it("ignores colour and special instructions (they do not affect price)", () => {
    expect(configHashFromRow(row({ color_id: "pla-black", special_instructions: "x" }))).toBe(
      configHashFromRow(row())
    )
  })
})

describe("quoteExpiresAt / isExpired", () => {
  it("expires 24h after creation", () => {
    const now = new Date("2026-07-24T00:00:00.000Z")
    expect(quoteExpiresAt(now)).toBe(new Date(now.getTime() + QUOTE_TTL_MS).toISOString())
  })

  it("is not expired before, but is at and after the expiry instant", () => {
    const expiresAt = "2026-07-24T12:00:00.000Z"
    expect(isExpired(expiresAt, new Date("2026-07-24T11:59:59.000Z"))).toBe(false)
    expect(isExpired(expiresAt, new Date("2026-07-24T12:00:00.000Z"))).toBe(true)
    expect(isExpired(expiresAt, new Date("2026-07-24T12:00:01.000Z"))).toBe(true)
  })
})
