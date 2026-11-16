import { describe, expect, it } from "vitest"

import {
  ACTIVE_PRINT_JOB_STATES,
  isActivePrintJobState,
  printJobMachine,
  PRINT_JOB_LABELS,
  type PrintJobEvent,
  type PrintJobState,
} from "@/src/domain/stateMachines/printJob"

const STATES: PrintJobState[] = [
  "pending",
  "released",
  "printing",
  "completed",
  "failed",
  "cancelled",
]
const EVENTS: PrintJobEvent[] = ["RELEASE", "STARTED", "COMPLETED", "FAILED", "RETRY", "CANCEL"]

const LEGAL: Record<string, PrintJobState> = {
  "pending|RELEASE": "released",
  "pending|CANCEL": "cancelled",
  "released|STARTED": "printing",
  "released|FAILED": "failed",
  "released|CANCEL": "cancelled",
  "printing|COMPLETED": "completed",
  "printing|FAILED": "failed",
  "printing|CANCEL": "cancelled",
  "failed|RETRY": "pending",
}

describe("printJobMachine full state × event matrix", () => {
  for (const state of STATES) {
    for (const event of EVENTS) {
      const expected = LEGAL[`${state}|${event}`]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(printJobMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(printJobMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = printJobMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(printJobMachine.can(state, event)).toBe(false)
        })
      }
    }
  }

  it("exposes every state and event", () => {
    expect([...printJobMachine.states].sort()).toEqual([...STATES].sort())
    expect([...printJobMachine.events].sort()).toEqual([...EVENTS].sort())
  })
})

describe("isActivePrintJobState", () => {
  it.each(STATES)("%s", (state) => {
    expect(isActivePrintJobState(state)).toBe(ACTIVE_PRINT_JOB_STATES.includes(state))
  })

  it("rejects a status that is not a print-job state at all", () => {
    expect(isActivePrintJobState("nonsense")).toBe(false)
  })
})

describe("PRINT_JOB_LABELS", () => {
  it("labels every state", () => {
    for (const state of STATES) expect(PRINT_JOB_LABELS[state]).toBeTruthy()
  })
})
