import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

import OrdersPage from "@/app/(studio)/orders/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

function seed(rows: Record<string, unknown>[]) {
  return createFakeDb({ orders: { rows, unique: ["id"] } })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed([])
})

afterEach(() => vi.clearAllMocks())

describe("OrdersPage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(OrdersPage()).rejects.toThrow("redirect:/login")
  })

  it("invites a first order when there are none", async () => {
    render(await OrdersPage())
    expect(screen.getByText(/No orders yet/)).toBeInTheDocument()
  })

  it("lists the user's orders with customer labels, newest first", async () => {
    db = seed([
      { id: "ord_1", user_id: "u1", status: "production_queued", created_at: "2026-01-01" },
      { id: "ord_2", user_id: "u1", status: "pending_payment", created_at: "2026-02-01" },
    ])
    render(await OrdersPage())
    const links = screen.getAllByRole("link")
    expect(links[0]).toHaveAttribute("href", "/orders/ord_2")
    expect(links[0]).toHaveTextContent("Confirming payment…")
    expect(links[1]).toHaveTextContent("Queued")
  })

  it("renders an empty list when the query fails", async () => {
    db.failNext({ message: "boom" })
    render(await OrdersPage())
    expect(screen.getByText(/No orders yet/)).toBeInTheDocument()
  })
})
