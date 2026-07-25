import { render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import OpsBoardPage from "@/app/(ops)/ops/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = (query: Record<string, string | string[]> = {}) => ({
  searchParams: Promise.resolve(query),
})

function boardRow(over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    user_id: "u1",
    status: "production_queued",
    payment_status: "paid",
    held_from_status: null,
    paid_at: "2026-01-05T00:00:00.000Z",
    created_at: "2026-01-05T00:00:00.000Z",
    quote_id: "qt_1",
    frozen_dv_id: "dv_1",
    payment_ref: "pay_1",
    customer_name: "Asha Rao",
    customer_email: "asha@example.com",
    material_id: "petg",
    amount_minor: 24360,
    print_job_id: "pj_1",
    printer_id: "prn_1",
    print_job_status: "printing",
    validation_status: "pass",
    exception_reason: null,
    ...over,
  }
}

function seed(rows: Record<string, unknown>[] = [boardRow()]) {
  return createFakeDb({
    ops_orders: { rows, unique: ["id"] },
    printers: {
      rows: [{ id: "prn_1", name: "Forge One", gateway_kind: "mock", created_at: "1" }],
      unique: ["id"],
    },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("OpsBoardPage — access", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    await expect(OpsBoardPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s an anonymous visitor", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(OpsBoardPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s an unparseable filter rather than crashing", async () => {
    await expect(OpsBoardPage(ctx({ exception: "exploded" }))).rejects.toThrow("not-found")
  })

  it("404s when the board query fails", async () => {
    db.failNext({ message: "boom" })
    await expect(OpsBoardPage(ctx())).rejects.toThrow("not-found")
  })
})

describe("OpsBoardPage — rendering", () => {
  it("shows one row per order with names, not raw ids", async () => {
    render(await OpsBoardPage(ctx()))
    const row = screen.getByRole("row", { name: /ord_1/ })
    expect(within(row).getByRole("link", { name: "ord_1" })).toHaveAttribute(
      "href",
      "/ops/orders/ord_1"
    )
    expect(within(row).getByText("Asha Rao")).toBeInTheDocument()
    expect(within(row).getByText("Queued")).toBeInTheDocument()
    expect(within(row).getByText("PETG")).toBeInTheDocument()
    expect(within(row).getByText("Forge One")).toBeInTheDocument()
    expect(within(row).getByText("₹243.60")).toBeInTheDocument()
  })

  it("badges an exception with its human label", async () => {
    db = seed([boardRow({ exception_reason: "print_failed" })])
    render(await OpsBoardPage(ctx()))
    // Scoped to the row: the same label is also a filter option.
    const row = screen.getByRole("row", { name: /ord_1/ })
    expect(within(row).getByText("Print failed")).toBeInTheDocument()
  })

  it("shows a placeholder rather than a blank cell for unknown values", async () => {
    db = seed([
      boardRow({
        printer_id: null,
        material_id: null,
        amount_minor: null,
        paid_at: null,
        customer_name: null,
      }),
    ])
    render(await OpsBoardPage(ctx()))
    const row = screen.getByRole("row", { name: /ord_1/ })
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(5)
  })

  it("falls back to the printer id when the printer has been removed", async () => {
    db = createFakeDb({
      ops_orders: { rows: [boardRow({ printer_id: "prn_gone" })], unique: ["id"] },
      printers: { rows: [], unique: ["id"] },
    })
    render(await OpsBoardPage(ctx()))
    expect(screen.getByText("prn_gone")).toBeInTheDocument()
  })

  it("still renders when the printer list cannot be read", async () => {
    db.failCall(2, { message: "boom" })
    render(await OpsBoardPage(ctx()))
    expect(screen.getByRole("row", { name: /ord_1/ })).toBeInTheDocument()
  })

  it("invites a filter change when nothing matches", async () => {
    db = seed([])
    render(await OpsBoardPage(ctx()))
    expect(screen.getByText("No orders match these filters.")).toBeInTheDocument()
  })

  it("pre-fills the filter form from the query string", async () => {
    render(await OpsBoardPage(ctx({ status: "printing", materialId: "petg", dueBefore: "2026-02-01" })))
    expect(screen.getByLabelText("Status")).toHaveValue("printing")
    expect(screen.getByLabelText("Material")).toHaveValue("petg")
    expect(screen.getByLabelText("Due")).toHaveValue("2026-02-01")
  })

  it("reads repeated query parameters as their first value", async () => {
    render(await OpsBoardPage(ctx({ status: ["printing", "shipped"] })))
    expect(screen.getByLabelText("Status")).toHaveValue("printing")
  })

  it("treats blank and empty-array parameters as absent", async () => {
    render(await OpsBoardPage(ctx({ status: "", materialId: [] })))
    expect(screen.getByLabelText("Status")).toHaveValue("")
    expect(screen.getByLabelText("Material")).toHaveValue("")
  })

  it("shows an unrecognised exception reason verbatim", async () => {
    db = seed([boardRow({ exception_reason: "meteor_strike" })])
    render(await OpsBoardPage(ctx()))
    const row = screen.getByRole("row", { name: /ord_1/ })
    expect(within(row).getByText("meteor_strike")).toBeInTheDocument()
  })

  it("offers only a disabled pager on a single page", async () => {
    render(await OpsBoardPage(ctx()))
    const pager = screen.getByRole("navigation", { name: "Pagination" })
    expect(within(pager).queryByRole("link")).not.toBeInTheDocument()
    expect(within(pager).getByText("Page 1")).toBeInTheDocument()
  })

  it("links to the next page and keeps the filters", async () => {
    db = createFakeDb({
      ops_orders: {
        rows: Array.from({ length: 26 }, (_, i) =>
          boardRow({ id: `ord_${String(i).padStart(2, "0")}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}` })
        ),
        unique: ["id"],
      },
      printers: { rows: [], unique: ["id"] },
    })
    render(await OpsBoardPage(ctx({ materialId: "petg" })))
    const pager = screen.getByRole("navigation", { name: "Pagination" })
    expect(within(pager).getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/ops?materialId=petg&page=1"
    )
  })

  it("links back from a later page", async () => {
    render(await OpsBoardPage(ctx({ page: "2" })))
    const pager = screen.getByRole("navigation", { name: "Pagination" })
    expect(within(pager).getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/ops?page=1"
    )
    expect(within(pager).getByText("Page 3")).toBeInTheDocument()
  })
})
