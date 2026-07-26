import type { CustomerTemplateKey } from "@/src/adapters/email"
import { getPaymentProvider } from "@/src/adapters/payments/factory"
import { insertAuditEvent } from "@/src/data/auditEvents"
import { applyPaymentOutcome, getOrder } from "@/src/data/orders"
import { getServiceDb } from "@/src/data/supabaseClients"
import {
  reviewRequestSchema,
  reviewTransition,
  type ReviewAction,
} from "@/src/domain/ops/review"
import type { OrderState } from "@/src/domain/stateMachines/order"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * What the customer hears about each review action (plan §6-S16 step 1).
 * Approving and releasing a hold say nothing: the order simply carries on, and
 * the next thing the customer hears is that their print has started.
 */
const CUSTOMER_TEMPLATE_FOR_REVIEW: Record<ReviewAction, CustomerTemplateKey | null> = {
  approve: null,
  release_hold: null,
  hold: "review_hold",
  reject: "cancellation_refund",
}

/**
 * Operator review actions (plan §4.6, §6-S14 step 3): approve, reject, hold and
 * release-hold, each with a mandatory reason and each recorded as an
 * `audit_events` row naming the actor.
 *
 * Rejecting refunds the customer: the refund is *initiated* here, and the
 * payment axis moves only when the provider's `refund.succeeded` webhook lands
 * (§6-S13) — we never mark money returned on our own say-so.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(appError("validation", "request body must be json"))
  }
  const parsed = reviewRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return jsonError(appError("validation", detail))
  }
  const { action, reason } = parsed.data

  const db = getServiceDb()
  const found = await getOrder(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "order not found"))
  const order = found.value

  const transition = reviewTransition(
    action,
    order.status as OrderState,
    order.held_from_status as OrderState | null
  )
  if (!transition.ok) return jsonError(transition.error)

  // Refund BEFORE cancelling: if the provider refuses, the order stays where it
  // was and the operator can retry, rather than being cancelled with the money
  // still held.
  let refundRef: string | null = null
  if (action === "reject") {
    if (order.payment_ref === null) {
      return jsonError(appError("precondition_failed", "this order has no payment to refund"))
    }
    const refund = await getPaymentProvider().createRefund(order.payment_ref)
    if (!refund.ok) return jsonError(refund.error)
    refundRef = refund.value.refundRef
  }

  const updated = await applyPaymentOutcome(db, order.id, {
    status: transition.value.status,
    ...(transition.value.heldFromStatus === undefined
      ? {}
      : { heldFromStatus: transition.value.heldFromStatus }),
  })
  if (!updated.ok) return jsonError(updated.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "order",
    entityId: order.id,
    action: `order.review.${action}`,
    metadata: {
      reason,
      from: order.status,
      to: transition.value.status,
      ...(refundRef === null ? {} : { refundRef }),
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  // Keyed by the audit event, not the order: an order can be held, released and
  // held again, and the customer should hear about each one (plan §6-S16 step 1).
  const template = CUSTOMER_TEMPLATE_FOR_REVIEW[action]
  if (template !== null) {
    const notified = await new PostgresJobQueue(db, new SystemClock()).enqueue({
      type: "notification.send",
      payload: { template, orderId: order.id },
      idempotencyKey: `${template}:${audited.value.id}`,
    })
    if (!notified.ok) return jsonError(notified.error)
  }

  return Response.json({ status: transition.value.status, refundRef }, { status: 200 })
}
