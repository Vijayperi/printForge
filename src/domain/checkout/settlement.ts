import { transitionOrThrow } from "@/src/domain/stateMachines/machine"
import {
  orderMachine,
  type OrderState,
  type PaymentEventName,
} from "@/src/domain/stateMachines/order"

/** Verdicts that let an order skip straight past design review (plan §6-S13 step 3). */
const AUTO_APPROVE_VERDICT = "pass"

export interface Settlement {
  status: OrderState
  /** True when an operator still has to look at the model before production. */
  needsReview: boolean
}

/**
 * Where a `pending_payment` order lands once its payment succeeds (plan §6-S13
 * step 3): PAYMENT_CONFIRMED → ENTER_REVIEW, then an automatic APPROVE when the
 * printability verdict is a clean `pass`. Anything else — a warning, a stale
 * report, no report at all — stops in `design_review` for an operator.
 *
 * Pure: the caller persists the resulting status and raises the ops
 * notification when `needsReview` is set.
 */
export function settleOrderAfterPayment(verdict: string | null): Settlement {
  const paid = transitionOrThrow(orderMachine, "pending_payment", "PAYMENT_CONFIRMED")
  const reviewing = transitionOrThrow(orderMachine, paid, "ENTER_REVIEW")
  if (verdict !== AUTO_APPROVE_VERDICT) {
    return { status: reviewing, needsReview: true }
  }
  return { status: transitionOrThrow(orderMachine, reviewing, "APPROVE"), needsReview: false }
}

/**
 * Which payment-axis event a refund of `refundedMinor` against an order worth
 * `orderTotalMinor` represents (plan §6-S13 step 3). A refund of the whole
 * amount — or, defensively, more than it — is a full refund; anything less is
 * partial. Amounts are integer paise, so this is an exact comparison.
 */
export function refundPaymentEvent(
  refundedMinor: number,
  orderTotalMinor: number
): PaymentEventName {
  return refundedMinor >= orderTotalMinor ? "REFUND_FULL" : "REFUND_PARTIAL"
}
