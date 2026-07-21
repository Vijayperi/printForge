import { describe, expect, it } from "vitest"

import {
  generationMachine,
  type GenerationEvent,
  type GenerationState,
} from "@/src/domain/stateMachines/generation"

const STATES: GenerationState[] = ["queued", "creating", "ready", "failed"]
const EVENTS: GenerationEvent[] = [
  "PROVIDER_ACCEPTED",
  "PROVIDER_COMPLETED",
  "PROVIDER_FAILED",
  "RETRY",
]

// The single source of truth for the legal transitions (plan §4.3).
const LEGAL: Record<string, GenerationState> = {
  "queued|PROVIDER_ACCEPTED": "creating",
  "queued|PROVIDER_FAILED": "failed",
  "creating|PROVIDER_COMPLETED": "ready",
  "creating|PROVIDER_FAILED": "failed",
  "failed|RETRY": "queued",
}

describe("generationMachine full state × event matrix", () => {
  for (const state of STATES) {
    for (const event of EVENTS) {
      const key = `${state}|${event}`
      const expected = LEGAL[key]
      if (expected !== undefined) {
        it(`${state} –${event}→ ${expected}`, () => {
          expect(generationMachine.next(state, event)).toEqual({ ok: true, value: expected })
          expect(generationMachine.can(state, event)).toBe(true)
        })
      } else {
        it(`${state} –${event}→ (illegal)`, () => {
          const result = generationMachine.next(state, event)
          expect(result.ok).toBe(false)
          if (!result.ok) expect(result.error.code).toBe("conflict")
          expect(generationMachine.can(state, event)).toBe(false)
        })
      }
    }
  }
})
