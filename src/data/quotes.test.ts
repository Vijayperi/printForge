import { describe, expect, it } from "vitest"

import {
  getQuote,
  insertQuote,
  listQuotesByConfiguration,
  updateQuoteStatus,
} from "@/src/data/quotes"
import type { QuoteBreakdownLine } from "@/src/domain/types"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ quotes: { rows, unique: ["id"] } })
}

const breakdown: QuoteBreakdownLine[] = [
  { key: "material", label: "Material", amount: { amountMinor: 5000, currency: "INR" } },
]

describe("insertQuote", () => {
  it("inserts with a generated qt_ id and defaults", async () => {
    const fake = db()
    const result = await insertQuote(fake, {
      configurationId: "cfg_1",
      amountMinor: 12345,
      breakdownJson: breakdown,
      expiresAt: "2026-02-01T00:00:00Z",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("qt", result.value.id)).toBe(true)
      expect(result.value.configuration_id).toBe("cfg_1")
      expect(result.value.amount_minor).toBe(12345)
      expect(result.value.status).toBe("active")
      expect(result.value.currency).toBe("INR")
      expect(result.value.slice_json).toBeNull()
      expect(result.value.breakdown_json).toEqual(breakdown)
    }
  })

  it("honors explicit status, currency, and sliceJson", async () => {
    const fake = db()
    const result = await insertQuote(fake, {
      configurationId: "cfg_2",
      amountMinor: 1,
      breakdownJson: breakdown,
      expiresAt: "2026-02-01T00:00:00Z",
      status: "expired",
      currency: "INR",
      sliceJson: { grams: 20 },
    })
    expect(result.ok && result.value.status).toBe("expired")
    expect(result.ok && result.value.slice_json).toEqual({ grams: 20 })
  })
})

describe("getQuote", () => {
  it("returns the quote by id", async () => {
    const fake = db([{ id: "qt_1", configuration_id: "cfg_1", created_at: "1" }])
    const result = await getQuote(fake, "qt_1")
    expect(result.ok && result.value?.id).toBe("qt_1")
  })

  it("returns null when absent", async () => {
    const result = await getQuote(db(), "qt_missing")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("listQuotesByConfiguration", () => {
  it("returns quotes for a configuration, newest first", async () => {
    const fake = db([
      { id: "qt_1", configuration_id: "cfg_1", created_at: "2026-01-01" },
      { id: "qt_2", configuration_id: "cfg_1", created_at: "2026-01-05" },
      { id: "qt_3", configuration_id: "cfg_2", created_at: "2026-01-09" },
    ])
    const result = await listQuotesByConfiguration(fake, "cfg_1")
    expect(result.ok && result.value.map((q) => q.id)).toEqual(["qt_2", "qt_1"])
  })
})

describe("updateQuoteStatus", () => {
  it("updates the status", async () => {
    const fake = db([{ id: "qt_1", configuration_id: "cfg_1", status: "active", created_at: "1" }])
    const result = await updateQuoteStatus(fake, "qt_1", "superseded")
    expect(result.ok && result.value.status).toBe("superseded")
  })

  it("fails when the quote is absent", async () => {
    const result = await updateQuoteStatus(db(), "qt_missing", "expired")
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})
