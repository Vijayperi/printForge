import { describe, expect, it } from "vitest"

import {
  addMoney,
  assertMoneyInvariant,
  formatINR,
  inr,
  multiplyMoney,
  percentOf,
  type Money,
} from "@/src/lib/money"

describe("inr / assertMoneyInvariant", () => {
  it("constructs valid money", () => {
    expect(inr(150)).toEqual({ amountMinor: 150, currency: "INR" })
  })

  it("accepts zero", () => {
    expect(inr(0).amountMinor).toBe(0)
  })

  it("rejects non-integer amounts", () => {
    expect(() => inr(1.5)).toThrow(/must be an integer/)
  })

  it("rejects negative amounts", () => {
    expect(() => inr(-1)).toThrow(/non-negative/)
  })

  it("rejects a non-INR currency", () => {
    const bad = { amountMinor: 100, currency: "USD" } as unknown as Money
    expect(() => assertMoneyInvariant(bad)).toThrow(/currency must be INR/)
  })
})

describe("addMoney", () => {
  it("adds amounts", () => {
    expect(addMoney(inr(100), inr(250))).toEqual(inr(350))
  })

  it("validates both operands", () => {
    const bad = { amountMinor: 0.5, currency: "INR" } as Money
    expect(() => addMoney(bad, inr(1))).toThrow(/integer/)
    expect(() => addMoney(inr(1), bad)).toThrow(/integer/)
  })
})

describe("multiplyMoney", () => {
  it("multiplies and rounds half-up at exactly .5", () => {
    expect(multiplyMoney(inr(3), 0.5)).toEqual(inr(2)) // 1.5 -> 2
    expect(multiplyMoney(inr(5), 0.5)).toEqual(inr(3)) // 2.5 -> 3
  })

  it("rounds down below .5", () => {
    expect(multiplyMoney(inr(4), 0.1)).toEqual(inr(0)) // 0.4 -> 0
  })

  it("rounds up above .5", () => {
    expect(multiplyMoney(inr(4), 0.4)).toEqual(inr(2)) // 1.6 -> 2
  })

  it("handles factor of zero and one", () => {
    expect(multiplyMoney(inr(999), 0)).toEqual(inr(0))
    expect(multiplyMoney(inr(999), 1)).toEqual(inr(999))
  })

  it("rejects negative factors", () => {
    expect(() => multiplyMoney(inr(100), -0.1)).toThrow(/non-negative finite/)
  })

  it("rejects non-finite factors", () => {
    expect(() => multiplyMoney(inr(100), Number.NaN)).toThrow(/non-negative finite/)
    expect(() => multiplyMoney(inr(100), Number.POSITIVE_INFINITY)).toThrow(/non-negative finite/)
  })

  it("validates the money operand", () => {
    const bad = { amountMinor: -5, currency: "INR" } as Money
    expect(() => multiplyMoney(bad, 1)).toThrow(/non-negative/)
  })
})

describe("percentOf", () => {
  it("computes basis points with half-up rounding", () => {
    expect(percentOf(inr(10_000), 1800)).toEqual(inr(1800)) // 18% GST of ₹100
    expect(percentOf(inr(1), 5000)).toEqual(inr(1)) // 0.5 -> 1
    expect(percentOf(inr(1), 4999)).toEqual(inr(0)) // 0.4999 -> 0
  })

  it("handles zero bps", () => {
    expect(percentOf(inr(12_345), 0)).toEqual(inr(0))
  })

  it("rejects negative bps", () => {
    expect(() => percentOf(inr(100), -1)).toThrow(/non-negative integer/)
  })

  it("rejects fractional bps", () => {
    expect(() => percentOf(inr(100), 12.5)).toThrow(/non-negative integer/)
  })
})

describe("formatINR", () => {
  it("formats with Indian digit grouping", () => {
    expect(formatINR(inr(123_456_789))).toBe("₹12,34,567.89")
  })

  it("formats sub-rupee amounts", () => {
    expect(formatINR(inr(50))).toBe("₹0.50")
  })

  it("formats zero", () => {
    expect(formatINR(inr(0))).toBe("₹0.00")
  })

  it("validates its input", () => {
    const bad = { amountMinor: 1.2, currency: "INR" } as Money
    expect(() => formatINR(bad)).toThrow(/integer/)
  })
})
