import { describe, expect, it } from "vitest"

import {
  TERMINAL_VALIDATION_STATES,
  validationMachine,
  type ValidationEvent,
  type ValidationState,
} from "@/src/domain/stateMachines/validation"

const STATES: ValidationState[] = [
  "pending",
  "analyzing",
  "pass",
  "warning",
  "manual_review",
  "fail",
]
const EVENTS: ValidationEvent[] = [
  "START",
  "RESULT_PASS",
  "RESULT_WARNING",
  "RESULT_MANUAL",
  "RESULT_FAIL",
  "REVALIDATE",
  "OPERATOR_APPROVE",
  "OPERATOR_REJECT",
]

// The single source of truth for the legal transitions (plan §4.3).
const LEGAL: Record<string, ValidationState> = {
  "pending|START": "analyzing",
  "analyzing|RESULT_PASS": "pass",
  "analyzing|RESULT_WARNING": "warning",
  "analyzing|RESULT_MANUAL": "manual_review",
  "analyzing|RESULT_FAIL": "fail",
  "pass|REVALIDATE": "pending",
  "warning|REVALIDATE": "pending",
  "manual_review|REVALIDATE": "pending",
  "manual_review|OPERATOR_APPROVE": "pass",
  "manual_review|OPERATOR_REJECT": "fail",
  "fail|REVALIDATE": "pending",
}

describe("validationMachine full state × event matrix", () => {
  for (const state of STATES) {
    for (const event of EVENTS) {
      const key = `${state}|${event}`
      const expected = LEGAL[key]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(validationMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(validationMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = validationMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(validationMachine.can(state, event)).toBe(false)
        })
      }
    }
  }
})

describe("TERMINAL_VALIDATION_STATES", () => {
  it("lists the four verdict states, none of which is pending/analyzing", () => {
    expect(TERMINAL_VALIDATION_STATES).toEqual(["pass", "warning", "manual_review", "fail"])
    expect(TERMINAL_VALIDATION_STATES).not.toContain("pending")
    expect(TERMINAL_VALIDATION_STATES).not.toContain("analyzing")
  })
})
