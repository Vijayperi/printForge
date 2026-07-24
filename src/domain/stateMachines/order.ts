import { defineMachine } from "@/src/domain/stateMachines/machine"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export type OrderState =
  | "pending_payment"
  | "paid"
  | "design_review"
  | "production_queued"
  | "printing"
  | "quality_check"
  | "shipped"
  | "delivered"
  | "on_hold"
  | "cancelled"

export type OrderEvent =
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "ENTER_REVIEW"
  | "APPROVE"
  | "REJECT"
  | "PRINT_STARTED"
  | "PRINT_COMPLETED"
  | "PRINT_FAILED"
  | "QC_PASSED"
  | "QC_FAILED"
  | "DELIVERED"
  | "HOLD"
  | "CANCEL"

/**
 * Order fulfillment lifecycle (plan §4.3). Payment lives on its own axis
 * (`paymentMachine`) so a refund never rewrites the fulfillment status.
 *
 * `RELEASE_HOLD` is deliberately absent from this table: its target depends on
 * the stored `held_from_status`, which a (state, event) → state table cannot
 * express. Use `releaseHold` — see DECISIONS.md.
 */
export const orderMachine = defineMachine<OrderState, OrderEvent>({
  pending_payment: { PAYMENT_CONFIRMED: "paid", PAYMENT_FAILED: "cancelled" },
  paid: { ENTER_REVIEW: "design_review", HOLD: "on_hold", CANCEL: "cancelled" },
  design_review: {
    APPROVE: "production_queued",
    REJECT: "cancelled",
    HOLD: "on_hold",
    CANCEL: "cancelled",
  },
  production_queued: { PRINT_STARTED: "printing", HOLD: "on_hold", CANCEL: "cancelled" },
  printing: {
    PRINT_COMPLETED: "quality_check",
    PRINT_FAILED: "production_queued",
    HOLD: "on_hold",
    CANCEL: "cancelled",
  },
  quality_check: {
    QC_PASSED: "shipped",
    QC_FAILED: "production_queued",
    HOLD: "on_hold",
    CANCEL: "cancelled",
  },
  shipped: { DELIVERED: "delivered" },
  delivered: {},
  on_hold: {},
  cancelled: {},
})

/**
 * The fulfillment states an operator may HOLD (plan §4.3: "any state
 * paid..quality_check"). An order returns to exactly the state it was held from.
 */
export const HOLDABLE_ORDER_STATES: readonly OrderState[] = [
  "paid",
  "design_review",
  "production_queued",
  "printing",
  "quality_check",
]

/**
 * The `on_hold` → `held_from_status` transition. Only an on-hold order can be
 * released, and only back to a state it could legally have been held from.
 */
export function releaseHold(state: OrderState, heldFrom: OrderState | null): Result<OrderState> {
  if (state !== "on_hold") {
    return err(appError("conflict", `illegal transition: ${state} –RELEASE_HOLD→`))
  }
  if (heldFrom === null || !HOLDABLE_ORDER_STATES.includes(heldFrom)) {
    return err(appError("conflict", `cannot release hold to ${String(heldFrom)}`))
  }
  return ok(heldFrom)
}

export type PaymentState = "unpaid" | "paid" | "partially_refunded" | "refunded"
export type PaymentEventName = "PAYMENT_SUCCEEDED" | "REFUND_PARTIAL" | "REFUND_FULL"

/**
 * Payment axis on an order (plan §4.3), independent of fulfillment per FR-7.
 * A second partial refund keeps the order `partially_refunded`.
 */
export const paymentMachine = defineMachine<PaymentState, PaymentEventName>({
  unpaid: { PAYMENT_SUCCEEDED: "paid" },
  paid: { REFUND_PARTIAL: "partially_refunded", REFUND_FULL: "refunded" },
  partially_refunded: { REFUND_PARTIAL: "partially_refunded", REFUND_FULL: "refunded" },
  refunded: {},
})

/**
 * Customer-visible status labels (plan §4.3). Total over `OrderState` so the
 * order pages never have to fall back to a raw status string.
 */
export const ORDER_CUSTOMER_LABELS: Record<OrderState, string> = {
  pending_payment: "Confirming payment…",
  paid: "Paid — preparing for production",
  design_review: "Design review",
  production_queued: "Queued",
  printing: "Printing",
  quality_check: "Quality check",
  shipped: "Shipped",
  delivered: "Delivered",
  on_hold: "On hold",
  cancelled: "Cancelled",
}

export function orderCustomerLabel(state: OrderState): string {
  return ORDER_CUSTOMER_LABELS[state]
}
