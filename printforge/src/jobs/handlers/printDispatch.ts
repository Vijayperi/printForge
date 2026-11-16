import "server-only"

import { z } from "zod"

import type { PrinterGateway } from "@/src/adapters/printerGateway"
import { getAsset } from "@/src/data/assets"
import { insertAuditEvent } from "@/src/data/auditEvents"
import type { Db } from "@/src/data/db"
import { getOrder } from "@/src/data/orders"
import { updatePrinterState } from "@/src/data/printers"
import { getPrintJob, updatePrintJobStatus } from "@/src/data/printJobs"
import { getQuote } from "@/src/data/quotes"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { assertDispatchable, dispatchFacts } from "@/src/domain/dispatchGuard"
import { PRINT_POLL_INTERVAL_MS, printJobAuditAction, printPollKey } from "@/src/domain/printDispatch"
import { printJobMachine, type PrintJobState } from "@/src/domain/stateMachines/printJob"
import type { PrintJobRow } from "@/src/domain/types"
import type { JobQueue } from "@/src/jobs/queue"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface PrintDispatchDeps {
  db: Db
  gateway: PrinterGateway
  queue: JobQueue
  clock: Clock
}

const dispatchPayload = z.object({
  printJobId: z.string().min(1),
  /** The operator who released it; absent when the worker re-dispatches. */
  actorId: z.string().min(1).nullish(),
  reason: z.string().min(1).nullish(),
})

/**
 * print.dispatch (plan §6-S15 step 4): send an approved job's G-code to its
 * machine and start watching it.
 *
 * The guard runs here rather than only in the route, because this is the last
 * point before a physical machine starts consuming filament — and the route is
 * not the only caller (the worker retries a dispatch that failed transiently).
 */
export async function handlePrintDispatch(
  deps: PrintDispatchDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = dispatchPayload.safeParse(rawPayload)
  if (!parsed.success) {
    return { ok: false, error: appError("validation", "invalid print.dispatch payload") }
  }
  const { printJobId } = parsed.data
  return dispatchPrintJob(deps, {
    printJobId,
    actorId: parsed.data.actorId ?? null,
    reason: parsed.data.reason ?? null,
  })
}

/**
 * Release one print job to its machine. Shared by the `print.dispatch` job and
 * the ops release route, so an operator pressing the button and the worker
 * retrying afterwards cannot take two different paths to a printer.
 */
export async function dispatchPrintJob(
  deps: PrintDispatchDeps,
  input: { printJobId: string; actorId: string | null; reason: string | null }
): Promise<Result<void>> {
  const found = await getPrintJob(deps.db, input.printJobId)
  if (!found.ok) return found
  if (found.value === null) {
    return { ok: false, error: appError("not_found", `print job ${input.printJobId} not found`) }
  }
  const job = found.value

  // Already on a machine: a replayed dispatch must not start a second print.
  if (job.gateway_job_ref !== null) return ok(undefined)

  const next = printJobMachine.next(job.status as PrintJobState, "RELEASE")
  if (!next.ok) return next

  const allowed = await assertJobDispatchable(deps.db, job)
  if (!allowed.ok) return allowed

  const gcode = await resolveGcodeKey(deps.db, job)
  if (!gcode.ok) return gcode

  // The guard above has proven a printer and a gcode asset are set; TypeScript
  // cannot see through it, and inventing a runtime check would be dead code.
  const printerId = job.printer_id as string
  const released = await deps.gateway.release({
    printJobId: job.id,
    printerId,
    gcodeStorageKey: gcode.value,
    // The job id *is* the idempotency key: one job is one print, forever.
    idempotencyKey: job.id,
  })
  if (!released.ok) return released

  const updated = await updatePrintJobStatus(deps.db, job.id, next.value, {
    gatewayJobRef: released.value.gatewayJobRef,
    failureReason: null,
  })
  if (!updated.ok) return updated

  // Our cached view of the fleet; the poller keeps it honest from here on.
  const printer = await updatePrinterState(deps.db, printerId, "busy", deps.clock.now().toISOString())
  if (!printer.ok) return printer

  const audited = await insertAuditEvent(deps.db, {
    ...(input.actorId === null ? {} : { actorId: input.actorId }),
    actorKind: input.actorId === null ? "system" : "user",
    entityType: "print_job",
    entityId: job.id,
    action: printJobAuditAction("RELEASE"),
    metadata: {
      orderId: job.order_id,
      printerId,
      attempt: job.attempt,
      gatewayJobRef: released.value.gatewayJobRef,
      ...(input.reason === null ? {} : { reason: input.reason }),
    },
  })
  if (!audited.ok) return audited

  return enqueuePoll(deps, job.id, 1)
}

/** Schedule the nth status poll of a job (plan §6-S15 step 4: a 30 s loop). */
export async function enqueuePoll(
  deps: PrintDispatchDeps,
  printJobId: string,
  poll: number
): Promise<Result<void>> {
  const enqueued = await deps.queue.enqueue({
    type: "print.poll",
    payload: { printJobId, poll },
    idempotencyKey: printPollKey(printJobId, poll),
    runAt: new Date(deps.clock.now().getTime() + PRINT_POLL_INTERVAL_MS),
  })
  return enqueued.ok ? ok(undefined) : enqueued
}

/** The six release preconditions, read off the rows this job depends on. */
async function assertJobDispatchable(db: Db, job: PrintJobRow): Promise<Result<void>> {
  const order = await getOrder(db, job.order_id)
  if (!order.ok) return order
  if (order.value === null) {
    return { ok: false, error: appError("not_found", `order ${job.order_id} not found`) }
  }
  const [quote, report] = await Promise.all([
    getQuote(db, order.value.quote_id),
    getLatestValidationReport(db, order.value.frozen_dv_id),
  ])
  if (!quote.ok) return quote
  if (!report.ok) return report

  return assertDispatchable(
    dispatchFacts({ order: order.value, job, quote: quote.value, report: report.value })
  )
}

/** Where the sliced G-code lives. The guard has already proven it exists. */
async function resolveGcodeKey(db: Db, job: PrintJobRow): Promise<Result<string>> {
  const asset = await getAsset(db, job.gcode_asset_id as string)
  if (!asset.ok) return asset
  if (asset.value === null) {
    return { ok: false, error: appError("not_found", "gcode asset not found") }
  }
  return ok(asset.value.storage_key)
}

/**
 * Stop a job that is (or may be) on a machine, and free the bay. Used by the ops
 * cancel control: cancelling a released job in the database alone would leave a
 * printer merrily printing an order nobody is watching any more.
 */
export async function cancelDispatchedJob(
  deps: PrintDispatchDeps,
  job: Pick<PrintJobRow, "id" | "printer_id" | "gateway_job_ref">
): Promise<Result<void>> {
  if (job.gateway_job_ref === null) return ok(undefined)

  const cancelled = await deps.gateway.cancel(job.gateway_job_ref)
  if (!cancelled.ok) return cancelled
  if (job.printer_id === null) return ok(undefined)

  // Ask the machine what it is doing now rather than assuming it went idle: a
  // cancel can leave a printer in an error state needing an operator.
  const status = await deps.gateway.printerStatus(job.printer_id)
  const state = status.ok ? status.value.state : "offline"
  const updated = await updatePrinterState(
    deps.db,
    job.printer_id,
    state,
    deps.clock.now().toISOString()
  )
  return updated.ok ? ok(undefined) : updated
}
