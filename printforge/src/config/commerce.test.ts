import { describe, expect, it } from "vitest"

import {
  CARRIER_IDS,
  carrierLabel,
  commerce,
  INDIAN_STATES,
  SHIPPING_CARRIERS,
  SHIPPING_COUNTRY,
} from "@/src/config/commerce"

describe("commerce windows", () => {
  it.each([
    ["production", commerce.productionWindow],
    ["delivery", commerce.deliveryWindow],
  ])("%s window is a non-empty range of business days", (_name, window) => {
    expect(window.minDays).toBeGreaterThan(0)
    expect(window.maxDays).toBeGreaterThanOrEqual(window.minDays)
  })
})

describe("shipping destinations", () => {
  it("ships to India only", () => {
    expect(SHIPPING_COUNTRY).toBe("IN")
  })

  it("lists every state and union territory exactly once", () => {
    expect(new Set(INDIAN_STATES).size).toBe(INDIAN_STATES.length)
  })
})

describe("carriers", () => {
  it("exposes the ids in the same order as the carriers themselves", () => {
    expect(CARRIER_IDS).toEqual(SHIPPING_CARRIERS.map((c) => c.id))
  })

  it("has unique ids", () => {
    expect(new Set(CARRIER_IDS).size).toBe(CARRIER_IDS.length)
  })

  it.each(SHIPPING_CARRIERS)("labels $id as $label", ({ id, label }) => {
    expect(carrierLabel(id)).toBe(label)
  })

  it("falls back to the stored value for a carrier we no longer offer", () => {
    expect(carrierLabel("some_retired_carrier")).toBe("some_retired_carrier")
  })
})
