import { ORDER_CUSTOMER_LABELS, type OrderState } from "@/src/domain/stateMachines/order"

/**
 * The happy-path an order walks for the customer (plan §4.3 labels). `on_hold`
 * and `cancelled` are deliberately absent — they are conditions shown alongside
 * the track, not stops on it.
 */
export const ORDER_TIMELINE: readonly OrderState[] = [
  "pending_payment",
  "paid",
  "design_review",
  "production_queued",
  "printing",
  "quality_check",
  "shipped",
  "delivered",
]

export interface TimelineStep {
  state: OrderState
  label: string
  status: "done" | "current" | "upcoming"
}

/**
 * Where the order sits on the customer-visible track. An on-hold order is shown
 * frozen at the step it was held from; a cancelled one has no position at all,
 * so every step reads as not-reached.
 */
function anchorFor(state: OrderState, heldFrom: OrderState | null): number {
  if (state === "cancelled") return -1
  if (state === "on_hold") {
    return heldFrom === null ? -1 : ORDER_TIMELINE.indexOf(heldFrom)
  }
  return ORDER_TIMELINE.indexOf(state)
}

export function orderTimeline(state: OrderState, heldFrom: OrderState | null): TimelineStep[] {
  const anchor = anchorFor(state, heldFrom)
  return ORDER_TIMELINE.map((step, index) => ({
    state: step,
    label: ORDER_CUSTOMER_LABELS[step],
    status: index < anchor ? "done" : index === anchor ? "current" : "upcoming",
  }))
}

/** True for the states that stop the track rather than advance it. */
export function isExceptionalOrderState(state: OrderState): boolean {
  return state === "on_hold" || state === "cancelled"
}
