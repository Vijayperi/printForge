import { describe, expect, it } from "vitest"

import { refundPaymentEvent, settleOrderAfterPayment } from "@/src/domain/checkout/settlement"

describe("settleOrderAfterPayment", () => {
  it("auto-approves a clean pass straight into production_queued", () => {
    expect(settleOrderAfterPayment("pass")).toEqual({
      status: "production_queued",
      needsReview: false,
    })
  })

  it("holds a warning verdict in design_review for an operator", () => {
    expect(settleOrderAfterPayment("warning")).toEqual({
      status: "design_review",
      needsReview: true,
    })
  })

  it("holds a manual_review verdict in design_review", () => {
    expect(settleOrderAfterPayment("manual_review")).toEqual({
      status: "design_review",
      needsReview: true,
    })
  })

  it("holds in design_review when there is no report at all", () => {
    expect(settleOrderAfterPayment(null)).toEqual({ status: "design_review", needsReview: true })
  })
})

describe("refundPaymentEvent", () => {
  it("treats a refund of the full order total as REFUND_FULL", () => {
    expect(refundPaymentEvent(24360, 24360)).toBe("REFUND_FULL")
  })

  it("treats a smaller refund as REFUND_PARTIAL", () => {
    expect(refundPaymentEvent(10000, 24360)).toBe("REFUND_PARTIAL")
  })

  it("treats an over-refund as REFUND_FULL rather than partial", () => {
    expect(refundPaymentEvent(30000, 24360)).toBe("REFUND_FULL")
  })

  it("treats a zero refund against a zero-total order as full", () => {
    expect(refundPaymentEvent(0, 0)).toBe("REFUND_FULL")
  })
})
