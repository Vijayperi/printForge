import { describe, expect, it } from "vitest"

import {
  REVIEW_ACTIONS,
  REVIEW_EVENTS,
  reviewRequestSchema,
  reviewTransition,
} from "@/src/domain/ops/review"
import {
  HOLDABLE_ORDER_STATES,
  orderMachine,
  type OrderState,
} from "@/src/domain/stateMachines/order"

describe("reviewRequestSchema", () => {
  it.each(REVIEW_ACTIONS)("accepts %s with a reason", (action) => {
    expect(reviewRequestSchema.parse({ action, reason: "looks wrong" }).action).toBe(action)
  })

  it("trims the reason", () => {
    expect(reviewRequestSchema.parse({ action: "hold", reason: "  wait  " }).reason).toBe("wait")
  })

  it.each([
    ["a missing reason", { action: "approve" }],
    ["a blank reason", { action: "approve", reason: "   " }],
    ["an over-long reason", { action: "approve", reason: "x".repeat(501) }],
    ["an unknown action", { action: "delete", reason: "why not" }],
    ["an extra key", { action: "approve", reason: "ok", force: true }],
  ])("rejects %s", (_label, input) => {
    expect(reviewRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe("reviewTransition", () => {
  it("approves a design review into production", () => {
    const result = reviewTransition("approve", "design_review", null)
    expect(result.ok && result.value).toEqual({ status: "production_queued" })
  })

  it("rejects a design review into cancelled", () => {
    const result = reviewTransition("reject", "design_review", null)
    expect(result.ok && result.value).toEqual({ status: "cancelled" })
  })

  it.each(HOLDABLE_ORDER_STATES)("holds %s and remembers where it came from", (state) => {
    const result = reviewTransition("hold", state, null)
    expect(result.ok && result.value).toEqual({ status: "on_hold", heldFromStatus: state })
  })

  it.each(HOLDABLE_ORDER_STATES)("releases a hold back to %s and clears the origin", (state) => {
    const result = reviewTransition("release_hold", "on_hold", state)
    expect(result.ok && result.value).toEqual({ status: state, heldFromStatus: null })
  })

  it("refuses to release an order that is not on hold", () => {
    const result = reviewTransition("release_hold", "printing", "paid")
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it("refuses to release a hold with no recorded origin", () => {
    const result = reviewTransition("release_hold", "on_hold", null)
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it.each([
    ["approve", "printing"],
    ["reject", "shipped"],
    ["hold", "delivered"],
    ["hold", "cancelled"],
  ] as const)("refuses to %s from %s", (action, state) => {
    const result = reviewTransition(action, state, null)
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it("agrees with the order machine on every direct action and state", () => {
    const states = orderMachine.states as OrderState[]
    for (const action of ["approve", "reject", "hold"] as const) {
      for (const state of states) {
        const expected = orderMachine.next(state, REVIEW_EVENTS[action])
        const actual = reviewTransition(action, state, null)
        expect(actual.ok).toBe(expected.ok)
        if (actual.ok && expected.ok) expect(actual.value.status).toBe(expected.value)
      }
    }
  })
})
