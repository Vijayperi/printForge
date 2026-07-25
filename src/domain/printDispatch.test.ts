import { describe, expect, it } from "vitest"

import {
  ORDER_EVENT_FOR_PRINT_EVENT,
  PRINT_FAILURE_REASONS,
  PRINT_POLL_INTERVAL_MS,
  pollOutcome,
  printFailureNotificationKey,
  printJobAuditAction,
  printPollKey,
  shouldKeepPolling,
  type PollOutcome,
} from "@/src/domain/printDispatch"
import type { PrinterGatewayState } from "@/src/domain/types"

const OURS = "gw-1"
const THEIRS = "gw-2"

function job(status: string, gatewayJobRef: string | null = OURS) {
  return { status, gatewayJobRef }
}

describe("pollOutcome", () => {
  /**
   * The full mapping the poller relies on: every job state a poll can find, in
   * every state a machine can report. Written out rather than generated, because
   * the asymmetries (idle means "done" only once printing; offline means "failed"
   * only once printing) are the point.
   */
  const cases = [
    // A finished job is never touched again, whatever the machine says.
    ["completed", "busy", OURS, { kind: "settled" }],
    ["failed", "error", OURS, { kind: "settled" }],
    ["cancelled", "idle", OURS, { kind: "settled" }],

    // Released, waiting for the machine to pick the job up.
    ["released", "idle", OURS, { kind: "waiting" }],
    ["released", "offline", OURS, { kind: "waiting" }],
    ["released", "busy", THEIRS, { kind: "waiting" }],
    ["released", "busy", OURS, { kind: "event", event: "STARTED" }],
    [
      "released",
      "error",
      OURS,
      { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.error },
    ],

    // Printing: now the machine's silence means something.
    ["printing", "busy", OURS, { kind: "waiting" }],
    ["printing", "idle", OURS, { kind: "event", event: "COMPLETED" }],
    [
      "printing",
      "error",
      OURS,
      { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.error },
    ],
    [
      "printing",
      "offline",
      OURS,
      { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.offline },
    ],
    [
      "printing",
      "busy",
      THEIRS,
      { kind: "event", event: "FAILED", failureReason: PRINT_FAILURE_REASONS.displaced },
    ],
  ] as const satisfies readonly [string, PrinterGatewayState, string, PollOutcome][]

  it.each(cases)("a %s job on a %s printer holding %s", (status, state, ref, expected) => {
    expect(pollOutcome(job(status), { state, currentJobRef: ref })).toEqual(expected)
  })

  it("treats a busy printer reporting no job at all as not ours", () => {
    expect(pollOutcome(job("printing"), { state: "busy" })).toEqual({
      kind: "event",
      event: "FAILED",
      failureReason: PRINT_FAILURE_REASONS.displaced,
    })
  })

  it("waits when a pending job's printer is merely busy with someone else", () => {
    expect(pollOutcome(job("pending", null), { state: "busy", currentJobRef: THEIRS })).toEqual({
      kind: "waiting",
    })
  })
})

describe("ORDER_EVENT_FOR_PRINT_EVENT", () => {
  it("maps each poll-driven print event to its order event (plan §4.3)", () => {
    expect(ORDER_EVENT_FOR_PRINT_EVENT).toEqual({
      STARTED: "PRINT_STARTED",
      COMPLETED: "PRINT_COMPLETED",
      FAILED: "PRINT_FAILED",
    })
  })
})

describe("printJobAuditAction", () => {
  it.each([
    ["RELEASE", "print_job.release"],
    ["STARTED", "print_job.started"],
    ["COMPLETED", "print_job.completed"],
    ["FAILED", "print_job.failed"],
  ] as const)("names the %s action", (event, action) => {
    expect(printJobAuditAction(event)).toBe(action)
  })
})

describe("poll and notification keys", () => {
  it("gives every poll of a job its own queue row", () => {
    expect(printPollKey("pj_1", 1)).toBe("print_poll:pj_1:1")
    expect(printPollKey("pj_1", 2)).not.toBe(printPollKey("pj_1", 1))
  })

  it("alerts again when a later attempt of the same job fails", () => {
    expect(printFailureNotificationKey("pj_1", 1)).toBe("ops_print_failure:pj_1:1")
    expect(printFailureNotificationKey("pj_1", 2)).not.toBe(
      printFailureNotificationKey("pj_1", 1)
    )
  })

  it("polls every 30 seconds, as the plan specifies", () => {
    expect(PRINT_POLL_INTERVAL_MS).toBe(30_000)
  })
})

describe("shouldKeepPolling", () => {
  it.each([
    ["pending", true],
    ["released", true],
    ["printing", true],
    ["completed", false],
    ["failed", false],
    ["cancelled", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(shouldKeepPolling(status)).toBe(expected)
  })
})
