import { z } from "zod"

import {
  orderMachine,
  releaseHold,
  type OrderEvent,
  type OrderState,
} from "@/src/domain/stateMachines/order"
import { ok, type Result } from "@/src/lib/result"

export const REVIEW_ACTIONS = ["approve", "reject", "hold", "release_hold"] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

/**
 * Body of `POST /api/ops/orders/[id]/review` (plan §4.6). The reason is
 * **mandatory** on every action — an audit trail that says only "an operator
 * cancelled this" is not an audit trail (plan §6-S14 step 3).
 */
export const reviewRequestSchema = z.strictObject({
  action: z.enum(REVIEW_ACTIONS),
  reason: z.string().trim().min(1, "a reason is required").max(500),
})

export type ReviewRequest = z.infer<typeof reviewRequestSchema>

/** The order-machine event each direct review action fires. */
export const REVIEW_EVENTS: Record<Exclude<ReviewAction, "release_hold">, OrderEvent> = {
  approve: "APPROVE",
  reject: "REJECT",
  hold: "HOLD",
}

export interface ReviewTransition {
  status: OrderState
  /** Present only when the action changes where a hold came from. */
  heldFromStatus?: string | null
}

/**
 * Resolve a review action against the order machine (plan §4.3). Pure: the
 * caller persists the result and writes the audit row.
 *
 * `release_hold` is not a table row — its target is the stored
 * `held_from_status` — so it routes through the `releaseHold` helper. A `hold`
 * remembers the state it interrupted so the release can undo it exactly.
 */
export function reviewTransition(
  action: ReviewAction,
  state: OrderState,
  heldFrom: OrderState | null
): Result<ReviewTransition> {
  if (action === "release_hold") {
    const released = releaseHold(state, heldFrom)
    return released.ok ? ok({ status: released.value, heldFromStatus: null }) : released
  }

  const next = orderMachine.next(state, REVIEW_EVENTS[action])
  if (!next.ok) return next
  return ok(action === "hold" ? { status: next.value, heldFromStatus: state } : { status: next.value })
}
