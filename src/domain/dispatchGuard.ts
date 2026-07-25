import type { OrderRow, PrintJobRow, QuoteRow, ValidationReportRow } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * The six things that must all be true before G-code may leave the building
 * (plan §6-S15 step 3). Every one of them is a way a customer could be charged
 * for, or sent, the wrong object — so the guard is its own module with an
 * exhaustive truth table rather than a chain of `if`s inside a route.
 */
export interface DispatchFacts {
  /** The order is paid for. */
  paid: boolean
  /** The order has cleared design review and is queued for production. */
  queued: boolean
  /** A quote was consumed at checkout, so a price was actually agreed. */
  quoteConsumed: boolean
  /** Printability came back `pass` — including an operator's manual approval. */
  validationPassed: boolean
  /** A sliced G-code asset exists for this job. */
  gcodeReady: boolean
  /** A machine has been chosen. */
  printerAssigned: boolean
}

/**
 * Checked in this order, so a job missing several preconditions reports the most
 * fundamental one. Money first, then approval, then the physical prerequisites.
 */
export const DISPATCH_FACT_ORDER = [
  "paid",
  "queued",
  "quoteConsumed",
  "validationPassed",
  "gcodeReady",
  "printerAssigned",
] as const satisfies readonly (keyof DispatchFacts)[]

/** Why a dispatch was refused, in language an operator can act on. */
export const DISPATCH_REASONS: Record<keyof DispatchFacts, string> = {
  paid: "this order has not been paid",
  queued: "this order is not queued for production",
  quoteConsumed: "this order has no consumed quote",
  validationPassed: "this design has not passed printability review",
  gcodeReady: "this job has no sliced gcode to send",
  printerAssigned: "this job has no printer assigned",
}

/**
 * May this print job be released to a machine? A failure is
 * `precondition_failed` — the state machine's RELEASE transition is perfectly
 * legal, we are refusing to make it (plan §4.3).
 */
export function assertDispatchable(facts: DispatchFacts): Result<void> {
  for (const fact of DISPATCH_FACT_ORDER) {
    if (!facts[fact]) return err(appError("precondition_failed", DISPATCH_REASONS[fact]))
  }
  return ok(undefined)
}

/**
 * Read the six facts off the rows involved. Kept separate from the guard so the
 * truth table can enumerate combinations without inventing database rows.
 *
 * `validation_reports.status === "pass"` covers an operator's manual approval:
 * OPERATOR_APPROVE moves a `manual_review` report to `pass` (plan §4.3), so
 * there is no second kind of approval to look for here.
 */
export function dispatchFacts(input: {
  order: Pick<OrderRow, "status" | "payment_status">
  job: Pick<PrintJobRow, "printer_id" | "gcode_asset_id">
  quote: Pick<QuoteRow, "status"> | null
  report: Pick<ValidationReportRow, "status"> | null
}): DispatchFacts {
  return {
    paid: input.order.payment_status === "paid",
    queued: input.order.status === "production_queued",
    quoteConsumed: input.quote?.status === "consumed",
    validationPassed: input.report?.status === "pass",
    gcodeReady: input.job.gcode_asset_id !== null,
    printerAssigned: input.job.printer_id !== null,
  }
}
