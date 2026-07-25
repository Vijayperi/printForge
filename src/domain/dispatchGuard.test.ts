import { describe, expect, it } from "vitest"

import {
  assertDispatchable,
  DISPATCH_FACT_ORDER,
  DISPATCH_REASONS,
  dispatchFacts,
  type DispatchFacts,
} from "@/src/domain/dispatchGuard"

/** Every combination of the six preconditions: 2^6 = 64 rows (plan §6-S15 step 3). */
function allCombinations(): DispatchFacts[] {
  const rows: DispatchFacts[] = []
  for (let mask = 0; mask < 1 << DISPATCH_FACT_ORDER.length; mask += 1) {
    const facts = {} as DispatchFacts
    DISPATCH_FACT_ORDER.forEach((fact, index) => {
      facts[fact] = (mask & (1 << index)) !== 0
    })
    rows.push(facts)
  }
  return rows
}

/** The reason the guard must give: the first unmet precondition, in check order. */
function expectedReason(facts: DispatchFacts): string | null {
  const missing = DISPATCH_FACT_ORDER.find((fact) => !facts[fact])
  return missing === undefined ? null : DISPATCH_REASONS[missing]
}

describe("assertDispatchable", () => {
  const combinations = allCombinations()

  it("enumerates every combination of the six preconditions", () => {
    expect(combinations).toHaveLength(64)
    expect(new Set(combinations.map((facts) => JSON.stringify(facts))).size).toBe(64)
  })

  it("releases only when every precondition holds", () => {
    const passing = combinations.filter((facts) => assertDispatchable(facts).ok)
    expect(passing).toEqual([
      {
        paid: true,
        queued: true,
        quoteConsumed: true,
        validationPassed: true,
        gcodeReady: true,
        printerAssigned: true,
      },
    ])
  })

  it.each(combinations.map((facts) => [JSON.stringify(facts), facts] as const))(
    "gives the first unmet precondition for %s",
    (_label, facts) => {
      const result = assertDispatchable(facts)
      const reason = expectedReason(facts)
      if (reason === null) {
        expect(result).toEqual({ ok: true, value: undefined })
        return
      }
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("precondition_failed")
        expect(result.error.message).toBe(reason)
      }
    }
  )

  it("has a reason for every fact it checks", () => {
    for (const fact of DISPATCH_FACT_ORDER) {
      expect(DISPATCH_REASONS[fact].length).toBeGreaterThan(0)
    }
    expect(Object.keys(DISPATCH_REASONS).sort()).toEqual([...DISPATCH_FACT_ORDER].sort())
  })
})

describe("dispatchFacts", () => {
  const dispatchable = {
    order: { status: "production_queued", payment_status: "paid" },
    job: { printer_id: "prn_1", gcode_asset_id: "ast_1" },
    quote: { status: "consumed" },
    report: { status: "pass" },
  }

  it("reads all six facts off a dispatchable order", () => {
    expect(dispatchFacts(dispatchable)).toEqual({
      paid: true,
      queued: true,
      quoteConsumed: true,
      validationPassed: true,
      gcodeReady: true,
      printerAssigned: true,
    })
    expect(assertDispatchable(dispatchFacts(dispatchable)).ok).toBe(true)
  })

  const negatives = [
    ["an unpaid order", { order: { ...dispatchable.order, payment_status: "unpaid" } }, "paid"],
    ["an order still in review", { order: { ...dispatchable.order, status: "design_review" } }, "queued"],
    ["a quote that was never consumed", { quote: { status: "active" } }, "quoteConsumed"],
    ["a missing quote", { quote: null }, "quoteConsumed"],
    ["a design that only warned", { report: { status: "warning" } }, "validationPassed"],
    ["a design with no report", { report: null }, "validationPassed"],
    ["a job with no gcode", { job: { ...dispatchable.job, gcode_asset_id: null } }, "gcodeReady"],
    ["a job with no printer", { job: { ...dispatchable.job, printer_id: null } }, "printerAssigned"],
  ] as const satisfies readonly [string, Partial<Parameters<typeof dispatchFacts>[0]>, keyof DispatchFacts][]

  it.each(negatives)("marks %s as not dispatchable", (_label, overrides, fact) => {
    const facts = dispatchFacts({ ...dispatchable, ...overrides })
    expect(facts[fact]).toBe(false)

    const result = assertDispatchable(facts)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe(DISPATCH_REASONS[fact])
  })
})
