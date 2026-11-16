import { describe, expect, it } from "vitest"

import { commerce } from "@/src/config/commerce"
import {
  DUE_BUSINESS_DAYS,
  dueDateFor,
  OPS_EXCEPTION_LABELS,
  OPS_EXCEPTION_REASONS,
  opsOrderFilterSchema,
  endOfDay,
  paidAtCutoffForDue,
  parseOpsOrderFilter,
  shiftBusinessDays,
} from "@/src/domain/ops/board"

describe("OPS_EXCEPTION_REASONS", () => {
  it("has a label for every reason the view can produce", () => {
    for (const reason of OPS_EXCEPTION_REASONS) {
      expect(OPS_EXCEPTION_LABELS[reason]).toBeTruthy()
    }
    expect(Object.keys(OPS_EXCEPTION_LABELS)).toHaveLength(OPS_EXCEPTION_REASONS.length)
  })
})

describe("shiftBusinessDays", () => {
  // 2026-01-01 is a Thursday.
  const thursday = new Date("2026-01-01T09:00:00.000Z")

  it("skips the weekend going forward", () => {
    // Thu +1 = Fri, +2 = Mon (Sat/Sun skipped).
    expect(shiftBusinessDays(thursday, 2).toISOString()).toBe("2026-01-05T09:00:00.000Z")
  })

  it("skips the weekend going backward", () => {
    const monday = new Date("2026-01-05T09:00:00.000Z")
    expect(shiftBusinessDays(monday, -1).toISOString()).toBe("2026-01-02T09:00:00.000Z")
    expect(shiftBusinessDays(monday, -2).toISOString()).toBe("2026-01-01T09:00:00.000Z")
  })

  it("returns the same instant for a zero shift", () => {
    expect(shiftBusinessDays(thursday, 0).toISOString()).toBe(thursday.toISOString())
  })

  it("never lands on a weekend", () => {
    for (let days = 1; days <= 30; days += 1) {
      const day = shiftBusinessDays(thursday, days).getUTCDay()
      expect(day === 0 || day === 6).toBe(false)
    }
  })
})

describe("dueDateFor", () => {
  it("is the outer edge of the production and delivery windows", () => {
    expect(DUE_BUSINESS_DAYS).toBe(
      commerce.productionWindow.maxDays + commerce.deliveryWindow.maxDays
    )
    const paidAt = "2026-01-01T09:00:00.000Z"
    expect(dueDateFor(paidAt)?.toISOString()).toBe(
      shiftBusinessDays(new Date(paidAt), DUE_BUSINESS_DAYS).toISOString()
    )
  })

  it("has no due date before payment lands", () => {
    expect(dueDateFor(null)).toBeNull()
  })

  it("has no due date for an unparseable timestamp", () => {
    expect(dueDateFor("not a date")).toBeNull()
  })
})

describe("paidAtCutoffForDue", () => {
  it("inverts dueDateFor, so the SQL bound and the displayed date agree", () => {
    const due = new Date("2026-02-02T09:00:00.000Z")
    const cutoff = paidAtCutoffForDue(due)
    expect(dueDateFor(cutoff.toISOString())?.toISOString()).toBe(due.toISOString())
  })
})

describe("opsOrderFilterSchema", () => {
  it("defaults to the first page with no filters", () => {
    expect(opsOrderFilterSchema.parse({})).toEqual({ page: 0 })
  })

  it("coerces the page from a query string", () => {
    expect(opsOrderFilterSchema.parse({ page: "3" }).page).toBe(3)
  })

  it.each([
    ["a negative page", { page: "-1" }],
    ["a fractional page", { page: "1.5" }],
    ["an unknown exception reason", { exception: "exploded" }],
    ["a non-ISO dueBefore", { dueBefore: "next tuesday" }],
    ["a dueBefore with a time", { dueBefore: "2026-02-01T00:00:00.000Z" }],
    ["an unexpected key", { sortBy: "amount" }],
  ])("rejects %s", (_label, input) => {
    expect(opsOrderFilterSchema.safeParse(input).success).toBe(false)
  })

  it("accepts the full filter set", () => {
    const parsed = opsOrderFilterSchema.parse({
      status: "printing",
      printerId: "prn_1",
      materialId: "pla",
      exception: "print_failed",
      dueBefore: "2026-02-01",
      page: "2",
    })
    expect(parsed.exception).toBe("print_failed")
    expect(parsed.page).toBe(2)
  })
})

describe("parseOpsOrderFilter", () => {
  it("drops absent and blank query parameters rather than failing on them", () => {
    const parsed = parseOpsOrderFilter({ status: "", printerId: undefined, materialId: "pla" })
    expect(parsed.success && parsed.data).toEqual({ materialId: "pla", page: 0 })
  })

  it("still rejects a genuinely bad value", () => {
    expect(parseOpsOrderFilter({ exception: "nope" }).success).toBe(false)
  })
})

describe("endOfDay", () => {
  it("covers the whole filter day, so an order due that afternoon still matches", () => {
    expect(endOfDay("2026-02-01").toISOString()).toBe("2026-02-01T23:59:59.999Z")
  })
})
