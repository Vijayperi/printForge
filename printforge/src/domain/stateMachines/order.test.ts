import { describe, expect, it } from "vitest"

import {
  HOLDABLE_ORDER_STATES,
  ORDER_CUSTOMER_LABELS,
  orderCustomerLabel,
  orderMachine,
  paymentMachine,
  releaseHold,
  type OrderEvent,
  type OrderState,
  type PaymentEventName,
  type PaymentState,
} from "@/src/domain/stateMachines/order"

const ORDER_STATES: OrderState[] = [
  "pending_payment",
  "paid",
  "design_review",
  "production_queued",
  "printing",
  "quality_check",
  "shipped",
  "delivered",
  "on_hold",
  "cancelled",
]

const ORDER_EVENTS: OrderEvent[] = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_FAILED",
  "ENTER_REVIEW",
  "APPROVE",
  "REJECT",
  "PRINT_STARTED",
  "PRINT_COMPLETED",
  "PRINT_FAILED",
  "QC_PASSED",
  "QC_FAILED",
  "DELIVERED",
  "HOLD",
  "CANCEL",
]

const LEGAL_ORDER: Record<string, OrderState> = {
  "pending_payment|PAYMENT_CONFIRMED": "paid",
  "pending_payment|PAYMENT_FAILED": "cancelled",
  "paid|ENTER_REVIEW": "design_review",
  "paid|HOLD": "on_hold",
  "paid|CANCEL": "cancelled",
  "design_review|APPROVE": "production_queued",
  "design_review|REJECT": "cancelled",
  "design_review|HOLD": "on_hold",
  "design_review|CANCEL": "cancelled",
  "production_queued|PRINT_STARTED": "printing",
  "production_queued|HOLD": "on_hold",
  "production_queued|CANCEL": "cancelled",
  "printing|PRINT_COMPLETED": "quality_check",
  "printing|PRINT_FAILED": "production_queued",
  "printing|HOLD": "on_hold",
  "printing|CANCEL": "cancelled",
  "quality_check|QC_PASSED": "shipped",
  "quality_check|QC_FAILED": "production_queued",
  "quality_check|HOLD": "on_hold",
  "quality_check|CANCEL": "cancelled",
  "shipped|DELIVERED": "delivered",
}

describe("orderMachine full state × event matrix", () => {
  for (const state of ORDER_STATES) {
    for (const event of ORDER_EVENTS) {
      const expected = LEGAL_ORDER[`${state}|${event}`]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(orderMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(orderMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = orderMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(orderMachine.can(state, event)).toBe(false)
        })
      }
    }
  }

  it("exposes every state and event", () => {
    expect([...orderMachine.states].sort()).toEqual([...ORDER_STATES].sort())
    expect([...orderMachine.events].sort()).toEqual([...ORDER_EVENTS].sort())
  })
})

describe("releaseHold", () => {
  for (const state of ORDER_STATES) {
    for (const heldFrom of ORDER_STATES) {
      const legal = state === "on_hold" && HOLDABLE_ORDER_STATES.includes(heldFrom)
      it(`${state} (held from ${heldFrom}) → ${legal ? heldFrom : "(illegal)"}`, () => {
        const result = releaseHold(state, heldFrom)
        if (legal) {
          expect(result).toEqual({ ok: true, value: heldFrom })
        } else {
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
        }
      })
    }
  }

  it("rejects a missing held_from_status", () => {
    const result = releaseHold("on_hold", null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("null")
  })

  it("every holdable state can actually be HELD", () => {
    for (const state of HOLDABLE_ORDER_STATES) {
      expect(orderMachine.can(state, "HOLD")).toBe(true)
    }
    const nonHoldable = ORDER_STATES.filter((s) => !HOLDABLE_ORDER_STATES.includes(s))
    for (const state of nonHoldable) {
      expect(orderMachine.can(state, "HOLD")).toBe(false)
    }
  })
})

const PAYMENT_STATES: PaymentState[] = ["unpaid", "paid", "partially_refunded", "refunded"]
const PAYMENT_EVENTS: PaymentEventName[] = ["PAYMENT_SUCCEEDED", "REFUND_PARTIAL", "REFUND_FULL"]

const LEGAL_PAYMENT: Record<string, PaymentState> = {
  "unpaid|PAYMENT_SUCCEEDED": "paid",
  "paid|REFUND_PARTIAL": "partially_refunded",
  "paid|REFUND_FULL": "refunded",
  "partially_refunded|REFUND_PARTIAL": "partially_refunded",
  "partially_refunded|REFUND_FULL": "refunded",
}

describe("paymentMachine full state × event matrix", () => {
  for (const state of PAYMENT_STATES) {
    for (const event of PAYMENT_EVENTS) {
      const expected = LEGAL_PAYMENT[`${state}|${event}`]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(paymentMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(paymentMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = paymentMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(paymentMachine.can(state, event)).toBe(false)
        })
      }
    }
  }

  it("exposes every state and event", () => {
    expect([...paymentMachine.states].sort()).toEqual([...PAYMENT_STATES].sort())
    expect([...paymentMachine.events].sort()).toEqual([...PAYMENT_EVENTS].sort())
  })
})

describe("customer-visible labels", () => {
  it("covers every order state with a non-empty label", () => {
    for (const state of ORDER_STATES) {
      expect(ORDER_CUSTOMER_LABELS[state].length).toBeGreaterThan(0)
      expect(orderCustomerLabel(state)).toBe(ORDER_CUSTOMER_LABELS[state])
    }
    expect(Object.keys(ORDER_CUSTOMER_LABELS).sort()).toEqual([...ORDER_STATES].sort())
  })

  it("matches the plan §4.3 wording for the fulfillment ladder", () => {
    expect(orderCustomerLabel("paid")).toBe("Paid — preparing for production")
    expect(orderCustomerLabel("design_review")).toBe("Design review")
    expect(orderCustomerLabel("production_queued")).toBe("Queued")
    expect(orderCustomerLabel("printing")).toBe("Printing")
    expect(orderCustomerLabel("quality_check")).toBe("Quality check")
    expect(orderCustomerLabel("shipped")).toBe("Shipped")
    expect(orderCustomerLabel("delivered")).toBe("Delivered")
  })

  it("never leaks a raw status string to the customer", () => {
    for (const state of ORDER_STATES) {
      expect(orderCustomerLabel(state)).not.toBe(state)
    }
  })
})
