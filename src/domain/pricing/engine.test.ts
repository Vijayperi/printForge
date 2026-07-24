import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { pricingRules, type PricingRules } from "@/src/config/pricingRules"
import {
  price,
  shippingRateMinor,
  type PriceableConfig,
  type PriceableSlice,
} from "@/src/domain/pricing/engine"
import { addMoney, inr } from "@/src/lib/money"

const RULES = pricingRules

function withRules(over: Partial<PricingRules>): PricingRules {
  return { ...RULES, ...over }
}

const slice = (over: Partial<PriceableSlice> = {}): PriceableSlice => ({
  materialGrams: 10,
  durationMinutes: 60,
  supportsUsed: false,
  ...over,
})
const cfg = (over: Partial<PriceableConfig> = {}): PriceableConfig => ({
  materialId: "pla",
  shippingSpeed: "standard",
  ...over,
})

function amount(result: ReturnType<typeof price>, key: string): number {
  return result.lines.find((l) => l.key === key)!.amount.amountMinor
}

describe("shippingRateMinor", () => {
  it("picks the first bracket that contains the weight, per speed", () => {
    expect(shippingRateMinor(RULES.shippingTiers, 250, "standard")).toBe(6000) // boundary → first tier
    expect(shippingRateMinor(RULES.shippingTiers, 251, "standard")).toBe(9000) // spills to second
    expect(shippingRateMinor(RULES.shippingTiers, 1000, "express")).toBe(20000)
    expect(shippingRateMinor(RULES.shippingTiers, 5000, "standard")).toBe(15000) // catch-all
  })
  it("returns 0 for an unknown speed", () => {
    expect(shippingRateMinor(RULES.shippingTiers, 10, "teleport")).toBe(0)
  })
  it("returns 0 when there are no tiers", () => {
    expect(shippingRateMinor([], 10, "standard")).toBe(0)
  })
})

describe("price — line structure", () => {
  it("emits exactly the seven contract keys in order", () => {
    const result = price(slice(), cfg(), RULES)
    expect(result.lines.map((l) => l.key)).toEqual([
      "material",
      "machine_time",
      "supports",
      "labor",
      "failure_allowance",
      "shipping",
      "tax",
    ])
  })

  it("total is exactly the sum of the lines", () => {
    const result = price(slice({ materialGrams: 42.7, durationMinutes: 137, supportsUsed: true }), cfg({ materialId: "petg", shippingSpeed: "express" }), RULES)
    const summed = result.lines.reduce((s, l) => addMoney(s, l.amount), inr(0))
    expect(result.total).toEqual(summed)
  })
})

describe("price — each rule on/off", () => {
  it("charges the supports surcharge only when supports are used", () => {
    expect(amount(price(slice({ supportsUsed: false }), cfg(), RULES), "supports")).toBe(0)
    const withSupports = amount(price(slice({ supportsUsed: true }), cfg(), RULES), "supports")
    expect(withSupports).toBeGreaterThan(0)
  })

  it("charges GST only in self tax mode", () => {
    expect(amount(price(slice(), cfg(), withRules({ taxMode: "mor_handled" })), "tax")).toBe(0)
    expect(amount(price(slice(), cfg(), withRules({ taxMode: "self" })), "tax")).toBeGreaterThan(0)
  })

  it("prices unknown materials at a zero material rate", () => {
    expect(amount(price(slice(), cfg({ materialId: "unobtanium" }), RULES), "material")).toBe(0)
  })

  it("always includes the flat labour charge", () => {
    expect(amount(price(slice(), cfg(), RULES), "labor")).toBe(RULES.laborFlatMinor)
  })
})

describe("price — rounding is half-up to the paisa", () => {
  it("rounds a .5 material amount up", () => {
    // 300 paise/g × 0.005 g = 1.5 → 2.
    expect(amount(price(slice({ materialGrams: 0.005, durationMinutes: 0, supportsUsed: false }), cfg(), RULES), "material")).toBe(2)
    // 300 × 0.0049 = 1.47 → 1.
    expect(amount(price(slice({ materialGrams: 0.0049, durationMinutes: 0 }), cfg(), RULES), "material")).toBe(1)
  })
})

describe("price — golden breakdowns", () => {
  const cases: Array<{ file: string; slice: PriceableSlice; config: PriceableConfig }> = [
    { file: "small-pla-display", slice: { materialGrams: 0.589, durationMinutes: 6, supportsUsed: false }, config: { materialId: "pla", shippingSpeed: "standard" } },
    { file: "medium-petg-supports", slice: { materialGrams: 50, durationMinutes: 180, supportsUsed: true }, config: { materialId: "petg", shippingSpeed: "express" } },
    { file: "large-pla-reinforced", slice: { materialGrams: 400, durationMinutes: 600, supportsUsed: true }, config: { materialId: "pla", shippingSpeed: "standard" } },
  ]

  for (const c of cases) {
    it(`matches the committed golden for ${c.file}`, () => {
      const golden = JSON.parse(readFileSync(join(__dirname, "../../../tests/fixtures/pricing", `${c.file}.json`), "utf8"))
      expect(price(c.slice, c.config, RULES)).toEqual(golden)
    })
  }
})

describe("price — monotonicity", () => {
  it("total is non-decreasing in grams and in minutes", () => {
    const base = price(slice({ materialGrams: 10, durationMinutes: 60 }), cfg(), RULES).total.amountMinor
    const moreGrams = price(slice({ materialGrams: 20, durationMinutes: 60 }), cfg(), RULES).total.amountMinor
    const moreMinutes = price(slice({ materialGrams: 10, durationMinutes: 120 }), cfg(), RULES).total.amountMinor
    expect(moreGrams).toBeGreaterThanOrEqual(base)
    expect(moreMinutes).toBeGreaterThanOrEqual(base)

    // Property sweep across a range of grams × minutes.
    let prev = 0
    for (let g = 0; g <= 100; g += 10) {
      const total = price(slice({ materialGrams: g, durationMinutes: 60, supportsUsed: true }), cfg(), RULES).total.amountMinor
      expect(total).toBeGreaterThanOrEqual(prev)
      prev = total
    }
  })
})
