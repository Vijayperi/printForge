import {
  isTerminalPrintJobState,
  type PrintJobEvent,
  type PrintJobState,
} from "@/src/domain/stateMachines/printJob"
import type { PrinterGatewayState } from "@/src/domain/types"

/** How often a released job asks its machine what happened (plan §6-S15 step 4). */
export const PRINT_POLL_INTERVAL_MS = 30_000

/** Why a print stopped, in the words the ops board and the operator will read. */
export const PRINT_FAILURE_REASONS = {
  error: "the printer reported an error",
  offline: "the printer went offline mid-print",
  displaced: "the printer moved on to another job",
} as const

/**
 * The print-job events a poll can produce, each paired with the order event it
 * drives (plan §4.3). RELEASE, RETRY and CANCEL are operator decisions and never
 * come from watching a machine, which is why this map is total for a poll.
 */
export const ORDER_EVENT_FOR_PRINT_EVENT = {
  STARTED: "PRINT_STARTED",
  COMPLETED: "PRINT_COMPLETED",
  FAILED: "PRINT_FAILED",
} as const

export type DispatchedPrintEvent = keyof typeof ORDER_EVENT_FOR_PRINT_EVENT

/**
 * What one poll of a machine means for the job we put on it.
 *
 * - `settled` — the job is already finished; stop polling.
 * - `waiting` — nothing has changed yet; poll again.
 * - `event` — fire this transition on the print job (and its order).
 */
export type PollOutcome =
  | { kind: "settled" }
  | { kind: "waiting" }
  | { kind: "event"; event: DispatchedPrintEvent; failureReason?: string }

/**
 * Map a gateway observation onto the print-job machine (plan §6-S15 step 4).
 *
 * The interesting cases are the asymmetric ones. A machine going *idle* is only
 * meaningful once we know it started: idle while merely `released` means it has
 * not begun, but idle while `printing` is how a finished print reports itself —
 * there is no "done" state in the §4.4 interface, so the transition to idle is
 * the completion signal. Likewise `offline` is only treated as a failure once a
 * print is under way; a machine that has not started yet may simply be booting,
 * and a released job that never starts is an operator's problem, not a lost print.
 */
export function pollOutcome(
  job: { status: string; gatewayJobRef: string | null },
  observed: { state: PrinterGatewayState; currentJobRef?: string }
): PollOutcome {
  if (isTerminalPrintJobState(job.status)) return { kind: "settled" }

  const printing = job.status === "printing"

  if (observed.state === "error") {
    return { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.error }
  }
  if (observed.state === "offline") {
    return printing
      ? { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.offline }
      : { kind: "waiting" }
  }
  if (observed.state === "busy") {
    // Someone else's file is on the bed. If ours was printing, it is gone.
    if (observed.currentJobRef !== job.gatewayJobRef) {
      return printing
        ? { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.displaced }
        : { kind: "waiting" }
    }
    return printing ? { kind: "waiting" } : { kind: "event", event: "STARTED" }
  }
  // Idle.
  return printing ? { kind: "event", event: "COMPLETED" } : { kind: "waiting" }
}

/** The audit action a print-job transition is recorded under. */
export function printJobAuditAction(event: PrintJobEvent): string {
  return `print_job.${event.toLowerCase()}`
}

/** Idempotency key for the nth poll of a job — each poll is its own queue row. */
export function printPollKey(printJobId: string, poll: number): string {
  return `print_poll:${printJobId}:${poll}`
}

/**
 * Idempotency key for the ops alert about a failed print. Keyed by attempt as
 * well as job, so a retried job that fails again really does alert again.
 */
export function printFailureNotificationKey(printJobId: string, attempt: number): string {
  return `ops_print_failure:${printJobId}:${attempt}`
}

/** The customer-facing milestones a poll can announce (plan §6-S16 step 1). */
export type PrintMilestone = "started" | "completed"

/**
 * The milestone each print event announces. A failed print is deliberately
 * absent: that is an ops alert, not customer news, so the type makes it
 * impossible to mail a customer about one.
 */
export const MILESTONE_FOR_PRINT_EVENT: Record<
  Exclude<DispatchedPrintEvent, "FAILED">,
  PrintMilestone
> = {
  STARTED: "started",
  COMPLETED: "completed",
}

/**
 * Idempotency key for a production milestone mail. Keyed by attempt as well as
 * job, so a reprint tells the customer it started again rather than being
 * swallowed as a duplicate of the first attempt.
 */
export function printMilestoneNotificationKey(
  printJobId: string,
  attempt: number,
  milestone: PrintMilestone
): string {
  return `production_milestone:${printJobId}:${attempt}:${milestone}`
}

/** The states a poll should keep watching (anything not yet terminal). */
export function shouldKeepPolling(status: PrintJobState): boolean {
  return !isTerminalPrintJobState(status)
}
