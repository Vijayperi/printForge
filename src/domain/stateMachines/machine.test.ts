import { describe, expect, it } from "vitest"

import { defineMachine, transitionOrThrow } from "@/src/domain/stateMachines/machine"

type S = "a" | "b" | "c"
type E = "GO" | "BACK" | "STOP"

const m = defineMachine<S, E>({
  a: { GO: "b" },
  b: { GO: "c", BACK: "a" },
  c: {},
})

describe("defineMachine", () => {
  it("exposes the declared states", () => {
    expect(m.states).toEqual(["a", "b", "c"])
  })

  it("collects the union of events across all states", () => {
    expect([...m.events].sort()).toEqual(["BACK", "GO"])
  })

  it("can() reports legal and illegal pairs", () => {
    expect(m.can("a", "GO")).toBe(true)
    expect(m.can("a", "BACK")).toBe(false)
    expect(m.can("c", "GO")).toBe(false)
  })

  it("next() returns the target for a legal transition", () => {
    expect(m.next("a", "GO")).toEqual({ ok: true, value: "b" })
    expect(m.next("b", "BACK")).toEqual({ ok: true, value: "a" })
  })

  it("next() returns a conflict error for an illegal transition", () => {
    const result = m.next("a", "STOP")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("conflict")
      expect(result.error.message).toContain("a")
      expect(result.error.message).toContain("STOP")
    }
  })

  it("next() rejects any event from a terminal state", () => {
    expect(m.next("c", "GO").ok).toBe(false)
    expect(m.next("c", "BACK").ok).toBe(false)
  })
})

describe("transitionOrThrow", () => {
  it("returns the target for a legal transition", () => {
    expect(transitionOrThrow(m, "a", "GO")).toBe("b")
  })

  it("throws a conflict error for an illegal transition", () => {
    expect(() => transitionOrThrow(m, "a", "STOP")).toThrow(/illegal transition/)
  })
})
