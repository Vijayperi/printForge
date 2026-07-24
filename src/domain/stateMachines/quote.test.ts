import { describe, expect, it } from "vitest"

import { quoteMachine, type QuoteEvent, type QuoteState } from "@/src/domain/stateMachines/quote"

const STATES: QuoteState[] = ["active", "expired", "superseded", "consumed"]
const EVENTS: QuoteEvent[] = ["EXPIRE", "SUPERSEDE", "CONSUME"]

const LEGAL: Record<string, QuoteState> = {
  "active|EXPIRE": "expired",
  "active|SUPERSEDE": "superseded",
  "active|CONSUME": "consumed",
}

describe("quoteMachine full state × event matrix", () => {
  for (const state of STATES) {
    for (const event of EVENTS) {
      const key = `${state}|${event}`
      const expected = LEGAL[key]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(quoteMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(quoteMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = quoteMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(quoteMachine.can(state, event)).toBe(false)
        })
      }
    }
  }
})
