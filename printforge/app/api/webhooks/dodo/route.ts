import type { PaymentEvent } from "@/src/adapters/payments"
import { getPaymentProvider } from "@/src/adapters/payments/factory"
import { insertAuditEvent } from "@/src/data/auditEvents"
import type { Db } from "@/src/data/db"
import { applyPaymentOutcome, getOrder, getOrderByPaymentRef } from "@/src/data/orders"
import { getQuote } from "@/src/data/quotes"
import { getServiceDb } from "@/src/data/supabaseClients"
import { getLatestValidationReport } from "@/src/data/validationReports"
import {
  getWebhookEvent,
  recordWebhookEvent,
  updateWebhookProcessingResult,
} from "@/src/data/webhookEvents"
import { refundPaymentEvent, settleOrderAfterPayment } from "@/src/domain/checkout/settlement"
import { transitionOrThrow } from "@/src/domain/stateMachines/machine"
import {
  HOLDABLE_ORDER_STATES,
  orderMachine,
  paymentMachine,
  type OrderState,
  type PaymentState,
} from "@/src/domain/stateMachines/order"
import type { OrderRow } from "@/src/domain/types"
import { PostgresJobQueue, type JobQueue } from "@/src/jobs/queue"
import { SystemClock, type Clock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

const PROVIDER = "dodo"

/**
 * How a webhook was handled, stored on `webhook_events.processing_result` and
 * echoed in the ACK body. Everything here is a 200 — the provider must stop
 * retrying — but only `processed` changed anything.
 */
type ProcessingResult =
  | "processed"
  | "ignored"
  | "unknown_order"
  | "out_of_order"
  | "already_paid"
  | "not_pending"
  | "late_payment_on_cancelled_order"
  | "not_holdable"
  | "illegal_refund"

interface Deps {
  db: Db
  queue: JobQueue
  clock: Clock
}

/**
 * A body we could not verify or understand. A bad signature is 401; anything
 * else (malformed JSON, a payload that does not match its own event type) is a
 * permanent 400 — retrying it would never help.
 */
function rejectedBody(error: AppError): Response {
  const { body } = toHttpError(error)
  return Response.json(body, { status: error.code === "unauthorized" ? 401 : 400 })
}

/** A processing failure must let the provider retry, so it is always a plain 500. */
function processingFailure(error: AppError): Response {
  return Response.json({ error: { code: error.code, message: error.message } }, { status: 500 })
}

function ack(result: ProcessingResult): Response {
  return Response.json({ status: result }, { status: 200 })
}

/** The verified body, kept for forensics. A non-object body is stored verbatim. */
function payloadForStorage(rawBody: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through to the raw form below
  }
  return { raw: rawBody }
}

/**
 * Raise an operator alert: an audit trail row plus a queued ops notification.
 * Used for every event that moves money we cannot reconcile automatically.
 */
async function alertOps(
  deps: Deps,
  input: { entityId: string; action: string; template: string; metadata: Record<string, unknown> }
): Promise<Result<void>> {
  const audit = await insertAuditEvent(deps.db, {
    actorKind: "system",
    entityType: "order",
    entityId: input.entityId,
    action: input.action,
    metadata: input.metadata,
  })
  if (!audit.ok) return audit

  const notify = await deps.queue.enqueue({
    type: "notification.send",
    payload: { template: input.template, ...input.metadata },
    idempotencyKey: `${input.template}:${input.entityId}`,
  })
  return notify.ok ? ok(undefined) : notify
}

async function audit(
  deps: Deps,
  orderId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<Result<void>> {
  const row = await insertAuditEvent(deps.db, {
    actorKind: "system",
    entityType: "order",
    entityId: orderId,
    action,
    metadata,
  })
  return row.ok ? ok(undefined) : row
}

/** Resolve the order a payment event names in its metadata. */
async function orderFromMetadata(
  deps: Deps,
  metadata: Record<string, string>
): Promise<Result<OrderRow | null>> {
  const orderId = metadata.order_id
  if (orderId === undefined) return ok(null)
  return getOrder(deps.db, orderId)
}

/**
 * `payment.succeeded` (plan §6-S13 step 3): confirm the order, flip the payment
 * axis, enter review, and auto-approve when the printability verdict is a clean
 * pass. Money that arrives for an order we already closed is never dropped — it
 * is recorded and escalated to ops.
 */
async function handleSucceeded(
  deps: Deps,
  event: Extract<PaymentEvent, { type: "payment.succeeded" }>
): Promise<Result<ProcessingResult>> {
  const found = await orderFromMetadata(deps, event.metadata)
  if (!found.ok) return found
  const order = found.value
  if (order === null) {
    const alerted = await alertOps(deps, {
      entityId: event.metadata.order_id ?? event.eventId,
      action: "payment.unknown_order",
      template: "ops_payment_unmatched",
      metadata: { paymentRef: event.paymentRef, amountMinor: event.amount.amountMinor },
    })
    return alerted.ok ? ok("unknown_order") : alerted
  }

  const paidAxis = transitionOrThrow(paymentMachine, "unpaid", "PAYMENT_SUCCEEDED")

  if (order.status === "cancelled") {
    // The order was closed before the money landed. `cancelled` is terminal, so
    // this is deliberately NOT a transition — record the payment and let an
    // operator refund it (plan §6-S13 step 3: never silently drop money).
    const recorded = await applyPaymentOutcome(deps.db, order.id, {
      paymentStatus: paidAxis,
      paymentRef: event.paymentRef,
      paidAt: deps.clock.now().toISOString(),
    })
    if (!recorded.ok) return recorded
    const alerted = await alertOps(deps, {
      entityId: order.id,
      action: "payment.late_on_cancelled_order",
      template: "ops_late_payment",
      metadata: { paymentRef: event.paymentRef, amountMinor: event.amount.amountMinor },
    })
    return alerted.ok ? ok("late_payment_on_cancelled_order") : alerted
  }

  if (order.status !== "pending_payment") return ok("already_paid")

  const report = await getLatestValidationReport(deps.db, order.frozen_dv_id)
  if (!report.ok) return report
  const settlement = settleOrderAfterPayment(report.value?.status ?? null)

  const updated = await applyPaymentOutcome(deps.db, order.id, {
    status: settlement.status,
    paymentStatus: paidAxis,
    paymentRef: event.paymentRef,
    // Stamped here rather than defaulted in SQL: the ops board's due date is
    // measured from the moment payment CONFIRMED, not from order creation.
    paidAt: deps.clock.now().toISOString(),
  })
  if (!updated.ok) return updated

  const audited = await audit(deps, order.id, "payment.succeeded", {
    paymentRef: event.paymentRef,
    amountMinor: event.amount.amountMinor,
    status: settlement.status,
    autoApproved: !settlement.needsReview,
  })
  if (!audited.ok) return audited

  const receipt = await deps.queue.enqueue({
    type: "notification.send",
    payload: { template: "order_receipt", orderId: order.id },
    idempotencyKey: `order_receipt:${order.id}`,
  })
  if (!receipt.ok) return receipt

  if (settlement.needsReview) {
    const alerted = await alertOps(deps, {
      entityId: order.id,
      action: "order.awaiting_design_review",
      template: "ops_order_review",
      metadata: { verdict: report.value?.status ?? null, orderId: order.id },
    })
    if (!alerted.ok) return alerted
  }
  return ok("processed")
}

/** `payment.failed`: close an order that never got paid. */
async function handleFailed(
  deps: Deps,
  event: Extract<PaymentEvent, { type: "payment.failed" }>
): Promise<Result<ProcessingResult>> {
  const found = await orderFromMetadata(deps, event.metadata)
  if (!found.ok) return found
  const order = found.value
  if (order === null) return ok("unknown_order")
  if (order.status !== "pending_payment") return ok("not_pending")

  const cancelled = await applyPaymentOutcome(deps.db, order.id, {
    status: transitionOrThrow(orderMachine, "pending_payment", "PAYMENT_FAILED"),
  })
  if (!cancelled.ok) return cancelled

  const audited = await audit(deps, order.id, "payment.failed", { reason: event.reason })
  return audited.ok ? ok("processed") : audited
}

/**
 * `refund.succeeded`: move the payment axis only — a refund never rewrites the
 * fulfillment status (plan §4.3). Full vs partial is decided by comparing the
 * refunded amount against what the order was quoted at.
 */
async function handleRefund(
  deps: Deps,
  event: Extract<PaymentEvent, { type: "refund.succeeded" }>
): Promise<Result<ProcessingResult>> {
  const found = await getOrderByPaymentRef(deps.db, event.paymentRef)
  if (!found.ok) return found
  const order = found.value
  if (order === null) {
    // We have not recorded this payment yet — the success event is still in
    // flight or was lost. Ops reconciles; we never guess.
    const alerted = await alertOps(deps, {
      entityId: event.paymentRef,
      action: "refund.unmatched_payment",
      template: "ops_refund_unmatched",
      metadata: { paymentRef: event.paymentRef, amountMinor: event.amount.amountMinor },
    })
    return alerted.ok ? ok("out_of_order") : alerted
  }

  const quote = await getQuote(deps.db, order.quote_id)
  if (!quote.ok) return quote
  if (quote.value === null) {
    const alerted = await alertOps(deps, {
      entityId: order.id,
      action: "refund.unresolvable_amount",
      template: "ops_refund_unmatched",
      metadata: { paymentRef: event.paymentRef, quoteId: order.quote_id },
    })
    return alerted.ok ? ok("unknown_order") : alerted
  }

  const axisEvent = refundPaymentEvent(event.amount.amountMinor, quote.value.amount_minor)
  const nextAxis = paymentMachine.next(order.payment_status as PaymentState, axisEvent)
  if (!nextAxis.ok) return ok("illegal_refund")

  const updated = await applyPaymentOutcome(deps.db, order.id, { paymentStatus: nextAxis.value })
  if (!updated.ok) return updated

  const audited = await audit(deps, order.id, "refund.succeeded", {
    paymentRef: event.paymentRef,
    amountMinor: event.amount.amountMinor,
    paymentStatus: nextAxis.value,
  })
  return audited.ok ? ok("processed") : audited
}

/** `dispute.opened`: freeze fulfillment where we still can, and always tell ops. */
async function handleDispute(
  deps: Deps,
  event: Extract<PaymentEvent, { type: "dispute.opened" }>
): Promise<Result<ProcessingResult>> {
  const found = await getOrderByPaymentRef(deps.db, event.paymentRef)
  if (!found.ok) return found
  const order = found.value
  if (order === null) {
    const alerted = await alertOps(deps, {
      entityId: event.paymentRef,
      action: "dispute.unmatched_payment",
      template: "ops_dispute_opened",
      metadata: { paymentRef: event.paymentRef },
    })
    return alerted.ok ? ok("out_of_order") : alerted
  }

  const heldFrom = order.status as OrderState
  const holdable = HOLDABLE_ORDER_STATES.includes(heldFrom)
  if (holdable) {
    const held = await applyPaymentOutcome(deps.db, order.id, {
      status: transitionOrThrow(orderMachine, heldFrom, "HOLD"),
      heldFromStatus: heldFrom,
    })
    if (!held.ok) return held
  }

  const alerted = await alertOps(deps, {
    entityId: order.id,
    action: "dispute.opened",
    template: "ops_dispute_opened",
    metadata: { paymentRef: event.paymentRef, heldFrom: holdable ? heldFrom : null },
  })
  if (!alerted.ok) return alerted
  return ok(holdable ? "processed" : "not_holdable")
}

function processEvent(deps: Deps, event: PaymentEvent): Promise<Result<ProcessingResult>> {
  switch (event.type) {
    case "payment.succeeded":
      return handleSucceeded(deps, event)
    case "payment.failed":
      return handleFailed(deps, event)
    case "refund.succeeded":
      return handleRefund(deps, event)
    case "dispute.opened":
      return handleDispute(deps, event)
    case "ignored":
      return Promise.resolve(ok("ignored"))
  }
}

/**
 * Claim this event id for processing. A brand-new event inserts its row; a
 * replay of one that was already processed to completion is reported as a
 * duplicate; a replay of one whose processing never finished (we crashed, or
 * answered 500) is handed back so the retry can complete it.
 */
async function claimEvent(
  db: Db,
  eventId: string,
  payload: Record<string, unknown>
): Promise<Result<{ rowId: string; alreadyProcessed: boolean }>> {
  const inserted = await recordWebhookEvent(db, { provider: PROVIDER, eventId, payload })
  if (inserted.ok) return ok({ rowId: inserted.value.id, alreadyProcessed: false })
  if (inserted.error.code !== "conflict") return inserted

  const existing = await getWebhookEvent(db, PROVIDER, eventId)
  if (!existing.ok) return existing
  if (existing.value === null) {
    return { ok: false, error: appError("internal", "webhook event vanished after a conflict") }
  }
  return ok({
    rowId: existing.value.id,
    alreadyProcessed: existing.value.processing_result !== null,
  })
}

/**
 * Dodo webhook sink (plan §4.6, §6-S13 step 3).
 *
 * The raw body is read FIRST and passed to the adapter untouched — parsing and
 * re-serializing would break the Standard Webhooks signature. Verification
 * failures are 401, malformed bodies 400, and a transient processing failure is
 * a 500 so the provider retries. Everything we understood — including a replay —
 * is a 200.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const verified = getPaymentProvider().verifyAndParseWebhook(rawBody, headers)
  if (!verified.ok) return rejectedBody(verified.error)
  const event = verified.value

  const db = getServiceDb()
  const clock = new SystemClock()
  const deps: Deps = { db, queue: new PostgresJobQueue(db, clock), clock }

  const claim = await claimEvent(db, event.eventId, payloadForStorage(rawBody))
  if (!claim.ok) return processingFailure(claim.error)
  if (claim.value.alreadyProcessed) return Response.json({ status: "duplicate" }, { status: 200 })

  const processed = await processEvent(deps, event)
  if (!processed.ok) return processingFailure(processed.error)

  const stamped = await updateWebhookProcessingResult(db, claim.value.rowId, processed.value)
  if (!stamped.ok) return processingFailure(stamped.error)
  return ack(processed.value)
}
