import { describe, expect, it } from "vitest"

import {
  isExceptionalOrderState,
  ORDER_TIMELINE,
  orderTimeline,
} from "@/src/domain/checkout/timeline"
import { ORDER_CUSTOMER_LABELS, type OrderState } from "@/src/domain/stateMachines/order"

function statuses(state: OrderState, heldFrom: OrderState | null = null): string[] {
  return orderTimeline(state, heldFrom).map((step) => step.status)
}

describe("ORDER_TIMELINE", () => {
  it("covers every non-exceptional order state exactly once", () => {
    const expected = (Object.keys(ORDER_CUSTOMER_LABELS) as OrderState[]).filter(
      (state) => !isExceptionalOrderState(state)
    )
    expect([...ORDER_TIMELINE]).toEqual(expected)
  })

  it("labels every step from the shared customer-label map", () => {
    for (const step of orderTimeline("printing", null)) {
      expect(step.label).toBe(ORDER_CUSTOMER_LABELS[step.state])
    }
  })
})

describe("orderTimeline", () => {
  it("marks the first step current for a brand-new order", () => {
    expect(statuses("pending_payment")).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ])
  })

  it("marks everything before the current state as done", () => {
    const steps = orderTimeline("printing", null)
    expect(steps.filter((s) => s.status === "done").map((s) => s.state)).toEqual([
      "pending_payment",
      "paid",
      "design_review",
      "production_queued",
    ])
    expect(steps.find((s) => s.status === "current")?.state).toBe("printing")
  })

  it("marks the whole track done at delivery", () => {
    const steps = orderTimeline("delivered", null)
    expect(steps.at(-1)?.status).toBe("current")
    expect(steps.slice(0, -1).every((s) => s.status === "done")).toBe(true)
  })

  it("freezes an on-hold order at the step it was held from", () => {
    expect(orderTimeline("on_hold", "printing").find((s) => s.status === "current")?.state).toBe(
      "printing"
    )
  })

  it("shows no position for an on-hold order with no recorded origin", () => {
    expect(statuses("on_hold", null).every((s) => s === "upcoming")).toBe(true)
  })

  it("shows no position at all for a cancelled order", () => {
    expect(statuses("cancelled").every((s) => s === "upcoming")).toBe(true)
  })
})

describe("isExceptionalOrderState", () => {
  it("is true only for on_hold and cancelled", () => {
    expect(isExceptionalOrderState("on_hold")).toBe(true)
    expect(isExceptionalOrderState("cancelled")).toBe(true)
    expect(isExceptionalOrderState("paid")).toBe(false)
  })
})
