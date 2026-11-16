import "server-only"

import { z } from "zod"

import { insertAuditEvent } from "@/src/data/auditEvents"
import { applyPaymentOutcome, getOrder } from "@/src/data/orders"
import { updatePrinterState } from "@/src/data/printers"
import { getPrintJob, updatePrintJobStatus } from "@/src/data/printJobs"
import {
  MILESTONE_FOR_PRINT_EVENT,
  ORDER_EVENT_FOR_PRINT_EVENT,
  pollOutcome,
  printFailureNotificationKey,
  printJobAuditAction,
  printMilestoneNotificationKey,
  type DispatchedPrintEvent,
  type PrintMilestone,
} from "@/src/domain/printDispatch"
import { orderMachine, type OrderState } from "@/src/domain/stateMachines/order"
import { printJobMachine, type PrintJobState } from "@/src/domain/stateMachines/printJob"
import type { OrderRow, PrintJobRow } from "@/src/domain/types"
import { enqueuePoll, type PrintDispatchDeps } from "@/src/jobs/handlers/printDispatch"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

const pollPayload = z.object({
  printJobId: z.string().min(1),
  poll: z.number().int().min(1),
})

/**
 * print.poll (plan §6-S15 step 4): ask a machine what happened to the job we
 * gave it, and move the print job — and its order — accordingly.
 *
 * The loop is self-rescheduling: every poll that finds the job still running
 * enqueues the next one 30 s out, and a terminal outcome simply stops. Nothing
 * is time-based inside the handler, so the whole lifecycle is walkable in tests.
 */
export async function handlePrintPoll(
  deps: PrintDispatchDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = pollPayload.safeParse(rawPayload)
  if (!parsed.success) {
    return { ok: false, error: appError("validation", "invalid print.poll payload") }
  }
  const { printJobId, poll } = parsed.data

  const found = await getPrintJob(deps.db, printJobId)
  if (!found.ok) return found
  if (found.value === null) {
    return { ok: false, error: appError("not_found", `print job ${printJobId} not found`) }
  }
  const job = found.value
  if (job.printer_id === null || job.gateway_job_ref === null) {
    return { ok: false, error: appError("precondition_failed", "this job is not on a printer") }
  }

  const observed = await deps.gateway.printerStatus(job.printer_id)
  if (!observed.ok) return observed

  const seenAt = deps.clock.now().toISOString()
  const refreshed = await updatePrinterState(deps.db, job.printer_id, observed.value.state, seenAt)
  if (!refreshed.ok) return refreshed

  const outcome = pollOutcome(
    { status: job.status, gatewayJobRef: job.gateway_job_ref },
    observed.value
  )
  switch (outcome.kind) {
    case "settled":
      return ok(undefined)
    case "waiting":
      return enqueuePoll(deps, job.id, poll + 1)
    default:
      return applyPrintEvent(deps, job, outcome.event, outcome.failureReason ?? null, poll)
  }
}

/** Write the print job's new state, drag the order along, and audit both. */
async function applyPrintEvent(
  deps: PrintDispatchDeps,
  job: PrintJobRow,
  event: DispatchedPrintEvent,
  failureReason: string | null,
  poll: number
): Promise<Result<void>> {
  const next = printJobMachine.next(job.status as PrintJobState, event)
  if (!next.ok) return next

  const updated = await updatePrintJobStatus(deps.db, job.id, next.value, {
    ...(failureReason === null ? {} : { failureReason }),
  })
  if (!updated.ok) return updated

  const order = await advanceOrder(deps, job, event)
  if (!order.ok) return order

  const audited = await insertAuditEvent(deps.db, {
    actorKind: "system",
    entityType: "print_job",
    entityId: job.id,
    action: printJobAuditAction(event),
    metadata: {
      orderId: job.order_id,
      printerId: job.printer_id,
      attempt: job.attempt,
      from: job.status,
      to: next.value,
      orderStatus: order.value.status,
      ...(order.value.moved ? {} : { orderStatusUnchanged: true }),
      ...(failureReason === null ? {} : { failureReason }),
    },
  })
  if (!audited.ok) return audited

  if (event === "FAILED") {
    const notified = await notifyPrintFailure(deps, job, failureReason)
    if (!notified.ok) return notified
  } else if (order.value.moved) {
    // Only when the order actually moved: an order an operator has held or
    // cancelled must not receive "your print has started" because a machine
    // finished the job that was already on it.
    const notified = await notifyMilestone(deps, job, MILESTONE_FOR_PRINT_EVENT[event])
    if (!notified.ok) return notified
  }
  // A finished or failed print stops the loop; the operator decides what next.
  return next.value === "printing" ? enqueuePoll(deps, job.id, poll + 1) : ok(undefined)
}

/**
 * Fire the matching order event (plan §4.3: PRINT_STARTED / PRINT_COMPLETED /
 * PRINT_FAILED).
 *
 * An illegal transition is *not* an error here. An operator may have put the
 * order on hold, or cancelled it, while the machine was printing; the print
 * still physically finished or failed, and that fact belongs in the print job
 * and the audit trail either way. What we must never do is drag an order out of
 * the state an operator deliberately moved it to — so the order is left alone
 * and the audit event records that it did not move.
 */
async function advanceOrder(
  deps: PrintDispatchDeps,
  job: PrintJobRow,
  event: DispatchedPrintEvent
): Promise<Result<{ status: string; moved: boolean }>> {
  const found = await getOrder(deps.db, job.order_id)
  if (!found.ok) return found
  if (found.value === null) {
    return { ok: false, error: appError("not_found", `order ${job.order_id} not found`) }
  }
  const order: OrderRow = found.value

  const next = orderMachine.next(order.status as OrderState, ORDER_EVENT_FOR_PRINT_EVENT[event])
  if (!next.ok) return ok({ status: order.status, moved: false })

  const updated = await applyPaymentOutcome(deps.db, order.id, { status: next.value })
  if (!updated.ok) return updated
  return ok({ status: next.value, moved: true })
}

/** Tell the customer their print started or finished (plan §6-S16 step 1). */
async function notifyMilestone(
  deps: PrintDispatchDeps,
  job: PrintJobRow,
  milestone: PrintMilestone
): Promise<Result<void>> {
  const enqueued = await deps.queue.enqueue({
    type: "notification.send",
    payload: { template: "production_milestone", orderId: job.order_id, milestone },
    idempotencyKey: printMilestoneNotificationKey(job.id, job.attempt, milestone),
  })
  return enqueued.ok ? ok(undefined) : enqueued
}

/** Tell ops a print failed (plan §6-S15 step 4: `ops_print_failure`). */
async function notifyPrintFailure(
  deps: PrintDispatchDeps,
  job: PrintJobRow,
  failureReason: string | null
): Promise<Result<void>> {
  const enqueued = await deps.queue.enqueue({
    type: "notification.send",
    payload: {
      template: "ops_print_failure",
      orderId: job.order_id,
      printJobId: job.id,
      printerId: job.printer_id,
      attempt: job.attempt,
      failureReason,
    },
    idempotencyKey: printFailureNotificationKey(job.id, job.attempt),
  })
  return enqueued.ok ? ok(undefined) : enqueued
}
