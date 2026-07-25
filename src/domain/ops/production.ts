import { z } from "zod"

import { CARRIER_IDS } from "@/src/config/commerce"
import {
  isActivePrintJobState,
  printJobMachine,
  type PrintJobState,
} from "@/src/domain/stateMachines/printJob"
import { orderMachine, type OrderState } from "@/src/domain/stateMachines/order"
import { transitionOrThrow } from "@/src/domain/stateMachines/machine"
import type { PrintJobRow } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * How many times one order may be put on a printer before it stops being a
 * retry and starts being an exception an operator has to look at (plan §6-S14
 * step 4). A newly created job is attempt 1, so the cap allows two retries.
 */
export const MAX_PRINT_ATTEMPTS = 3

/**
 * Why the release button is inert in this session. Dispatch to a physical
 * printer is Session 15 (`src/adapters/printerGateway`); until it exists the ops
 * UI shows the control disabled *with this reason* rather than hiding it, so an
 * operator can tell "not built yet" apart from "blocked by a precondition".
 */
export const RELEASE_DISABLED_REASON =
  "Dispatch to printers is not enabled yet — release unlocks with the printer gateway."

const reasonSchema = z.string().trim().min(1, "a reason is required").max(500)

/** Body shared by the retry and cancel controls: a mandatory audited reason. */
export const printJobActionSchema = z.strictObject({ reason: reasonSchema })

/** Body of `POST /api/ops/orders/[id]/print-jobs`. */
export const createPrintJobSchema = z.strictObject({ reason: reasonSchema })

/** Body of `POST /api/ops/print-jobs/[id]/assign`. */
export const assignPrinterSchema = z.strictObject({
  printerId: z.string().trim().min(1, "a printer is required"),
  reason: reasonSchema,
})

export const QC_OUTCOMES = ["pass", "fail"] as const
export type QcOutcome = (typeof QC_OUTCOMES)[number]

/** Body of `POST /api/ops/print-jobs/[id]/qc`. */
export const qcRequestSchema = z.strictObject({
  outcome: z.enum(QC_OUTCOMES),
  reason: reasonSchema,
})

/**
 * Body of `POST /api/ops/orders/[id]/shipment` (plan §4.6). No reason field:
 * the carrier and tracking number *are* the record of what happened, and §4.6
 * fixes this body.
 */
export const shipmentRequestSchema = z.strictObject({
  carrier: z.enum(CARRIER_IDS),
  trackingNumber: z
    .string()
    .trim()
    .min(4, "a tracking number is required")
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "tracking numbers are letters, digits and hyphens"),
})

/** The job currently holding this order, if any (plan §4.3 active states). */
export function activePrintJob(jobs: readonly PrintJobRow[]): PrintJobRow | null {
  return jobs.find((job) => isActivePrintJobState(job.status)) ?? null
}

/**
 * Which print of this order the next job would be. The cap counts prints of the
 * **order**, not retries of one job — a reprint after a failed quality check
 * consumes a machine hour exactly like a retry does, so both are counted.
 *
 * Cancelled jobs are skipped: a job cancelled before it printed never cost
 * anything, and shouldn't spend one of the order's three attempts.
 */
export function nextAttemptNumber(jobs: readonly PrintJobRow[]): number {
  const spent = jobs.filter((job) => job.status !== "cancelled").map((job) => job.attempt)
  return spent.length === 0 ? 1 : Math.max(...spent) + 1
}

/**
 * May an operator start a print job for this order (plan §6-S14 step 4: "paid +
 * approved orders w/o active job")? A rejection names the specific missing
 * precondition so the ops UI can say why the button is disabled.
 */
export function assertCanCreatePrintJob(
  order: { status: string; payment_status: string },
  jobs: readonly PrintJobRow[]
): Result<void> {
  if (order.payment_status === "unpaid") {
    return err(appError("precondition_failed", "this order has not been paid"))
  }
  if (order.status !== "production_queued") {
    return err(
      appError("precondition_failed", `an order in ${order.status} is not queued for production`)
    )
  }
  const active = activePrintJob(jobs)
  if (active !== null) {
    return err(appError("precondition_failed", `print job ${active.id} is still active`))
  }
  if (nextAttemptNumber(jobs) > MAX_PRINT_ATTEMPTS) {
    return err(
      appError(
        "precondition_failed",
        `this order has already been printed ${MAX_PRINT_ATTEMPTS} times — escalate instead of reprinting`
      )
    )
  }
  return ok(undefined)
}

/** A printer may only be assigned while the job is still ours to schedule. */
export function assertCanAssignPrinter(job: { status: string }): Result<void> {
  if (job.status !== "pending") {
    return err(
      appError("precondition_failed", `a ${job.status} job cannot be moved to another printer`)
    )
  }
  return ok(undefined)
}

export interface RetryOutcome {
  status: PrintJobState
  attempt: number
}

/**
 * Retry a failed print (plan §6-S14 step 4). The attempt counter is the cap:
 * once the order has burned `MAX_PRINT_ATTEMPTS` prints it stops being retried
 * and stays `failed`, where the ops board surfaces it as a `print_failed`
 * exception (built in Phase A).
 */
export function retryPrintJob(job: { status: string; attempt: number }): Result<RetryOutcome> {
  const next = printJobMachine.next(job.status as PrintJobState, "RETRY")
  if (!next.ok) return next
  if (job.attempt >= MAX_PRINT_ATTEMPTS) {
    return err(
      appError(
        "precondition_failed",
        `this order has already been printed ${job.attempt} times (cap ${MAX_PRINT_ATTEMPTS}) — escalate instead of retrying`
      )
    )
  }
  return ok({ status: next.value, attempt: job.attempt + 1 })
}

export interface QcResult {
  /** Where the order ends up. A pass does not move it — shipping does. */
  orderStatus: OrderState
  /** True when the operator should now be shown the shipment form. */
  awaitingShipment: boolean
}

/**
 * Record the quality-check outcome of a finished print (plan §6-S14 step 4).
 *
 * A pass deliberately does **not** transition the order: §4.3 spells the
 * transition "QC_PASSED **+ tracking added** → shipped", so the order stays in
 * `quality_check` until a shipment actually exists. A fail sends it back to the
 * production queue for a reprint.
 */
export function qcPrintJob(
  outcome: QcOutcome,
  orderStatus: string,
  jobStatus: string
): Result<QcResult> {
  if (jobStatus !== "completed") {
    return err(appError("precondition_failed", `a ${jobStatus} print job has no result to check`))
  }
  if (orderStatus !== "quality_check") {
    return err(appError("conflict", `illegal transition: ${orderStatus} –QC_${outcome}→`))
  }
  if (outcome === "pass") {
    return ok({ orderStatus: "quality_check", awaitingShipment: true })
  }
  // `quality_check` is a literal here (guarded above), so QC_FAILED is legal by
  // construction — no dead error branch.
  return ok({
    orderStatus: transitionOrThrow(orderMachine, "quality_check", "QC_FAILED"),
    awaitingShipment: false,
  })
}

/** One control on the ops production panel: whether to draw it, and if so, why it is inert. */
export interface Control {
  shown: boolean
  disabledReason: string | null
}

export interface PrintJobControls {
  create: Control
  assign: Control
  release: Control
  retry: Control
  cancel: Control
  qc: Control
}

const HIDDEN: Control = { shown: false, disabledReason: null }

function control(shown: boolean, guard: Result<unknown>): Control {
  return { shown, disabledReason: guard.ok ? null : guard.error.message }
}

/**
 * Which production controls an operator sees on an order, and why each inert one
 * is inert (plan §6-S14 step 4). Every rule lives here rather than in the panel:
 * the server decides what is legal, the client only draws it — and the same
 * guards run again inside the routes, so a stale page cannot do damage.
 *
 * The controls hang off the *latest* job, not the active one: a `completed` job
 * is no longer active but is exactly the one awaiting a quality check.
 */
export function printJobControls(
  order: { status: string; payment_status: string },
  jobs: readonly PrintJobRow[]
): PrintJobControls {
  const latest = jobs[0] ?? null
  if (latest === null) {
    return {
      ...{ assign: HIDDEN, release: HIDDEN, retry: HIDDEN, cancel: HIDDEN, qc: HIDDEN },
      create: control(true, assertCanCreatePrintJob(order, jobs)),
    }
  }
  return {
    create: control(true, assertCanCreatePrintJob(order, jobs)),
    assign: control(latest.status === "pending", assertCanAssignPrinter(latest)),
    // Release is drawn but never live in S14 — the printer gateway is S15.
    release: { shown: latest.status === "pending", disabledReason: RELEASE_DISABLED_REASON },
    retry: control(latest.status === "failed", retryPrintJob(latest)),
    cancel: { shown: printJobMachine.can(latest.status as PrintJobState, "CANCEL"), disabledReason: null },
    qc: control(
      latest.status === "completed",
      order.status === "quality_check"
        ? ok(undefined)
        : err(
            appError(
              "precondition_failed",
              `an order in ${order.status} is not awaiting a quality check`
            )
          )
    ),
  }
}

/** The audit action a recorded quality check is written under. */
export function qcAuditAction(outcome: QcOutcome): string {
  return `print_job.qc.${outcome}`
}

/**
 * Whether a passing quality check has been recorded on this print job.
 *
 * A pass changes no row — it only writes an audit event (see `qcPrintJob`) —
 * so the trail is the single source of truth, and reader and writer share
 * `qcAuditAction` so the string cannot drift between them.
 */
export function hasQcPass(events: readonly { action: string }[]): boolean {
  return events.some((event) => event.action === qcAuditAction("pass"))
}

/**
 * `hidden` — nothing to ship yet; `awaiting_qc` — printed, but no operator has
 * signed off; `ready` — show the shipment form.
 */
export type ShipmentStage = "hidden" | "awaiting_qc" | "ready"

/**
 * Whether an operator may record a shipment (plan §6-S14 step 4: "pass →
 * prompts shipment"). Only `quality_check` qualifies: a QC fail sends the order
 * back to `production_queued`, and a shipped order already has its tracking
 * number.
 */
export function shipmentStage(orderStatus: string, qcPassed: boolean): ShipmentStage {
  if (orderStatus !== "quality_check") return "hidden"
  return qcPassed ? "ready" : "awaiting_qc"
}
