import { describe, expect, it } from "vitest"

import { formatDay } from "@/src/components/ops/orders-table"

describe("formatDay", () => {
  it("formats an ISO timestamp as a UTC day", () => {
    expect(formatDay("2026-02-01T18:00:00.000Z")).toBe("1 Feb 2026")
  })

  it("shows a placeholder when there is no date", () => {
    expect(formatDay(null)).toBe("—")
  })

  it("shows a placeholder rather than 'Invalid Date' for a corrupt value", () => {
    expect(formatDay("not a timestamp")).toBe("—")
  })
})
