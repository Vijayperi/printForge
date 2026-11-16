import { defineMachine } from "@/src/domain/stateMachines/machine"

export type PrintJobState =
  | "pending"
  | "released"
  | "printing"
  | "completed"
  | "failed"
  | "cancelled"

export type PrintJobEvent = "RELEASE" | "STARTED" | "COMPLETED" | "FAILED" | "RETRY" | "CANCEL"

/**
 * Lifecycle of one attempt to print an order on one machine (plan §4.3).
 *
 * `RELEASE` is a table row like any other, but the API layer additionally runs
 * the dispatch preconditions guard before firing it (plan §6-S15): a guard
 * failure is `precondition_failed`, not an illegal transition — the transition
 * itself was legal, we simply refused to make it.
 */
export const printJobMachine = defineMachine<PrintJobState, PrintJobEvent>({
  pending: { RELEASE: "released", CANCEL: "cancelled" },
  released: { STARTED: "printing", FAILED: "failed", CANCEL: "cancelled" },
  printing: { COMPLETED: "completed", FAILED: "failed", CANCEL: "cancelled" },
  completed: {},
  failed: { RETRY: "pending" },
  cancelled: {},
})

/**
 * The states in which a job still owns its order and its printer. An order may
 * have at most one job in these states at a time (mirrored in the database by
 * the partial unique index on `print_jobs(printer_id)`).
 */
export const ACTIVE_PRINT_JOB_STATES: readonly PrintJobState[] = [
  "pending",
  "released",
  "printing",
]

/**
 * The states in which a machine is actually holding the job's file — a `pending`
 * job has been queued but nothing has been sent anywhere yet. These are exactly
 * the states in the `print_jobs_active_printer_idx` partial unique index, which
 * is the database half of the release interlock (plan §6-S15 step 2).
 */
export const HOLDING_PRINT_JOB_STATES: readonly PrintJobState[] = ["released", "printing"]

/** Nothing more will happen to this job on its own. */
export function isTerminalPrintJobState(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

/** Narrowing predicate over a raw `print_jobs.status` string. */
export function isActivePrintJobState(status: string): boolean {
  return (ACTIVE_PRINT_JOB_STATES as readonly string[]).includes(status)
}

/** Operator-facing labels for a print job's status (ops UI, plan §6-S14 step 4). */
export const PRINT_JOB_LABELS: Record<PrintJobState, string> = {
  pending: "Not released",
  released: "Released to printer",
  printing: "Printing",
  completed: "Printed",
  failed: "Failed",
  cancelled: "Cancelled",
}
