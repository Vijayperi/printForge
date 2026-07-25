import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

vi.mock("@/src/components/orders/order-status", () => ({
  OrderStatus: (props: { state: string; heldFrom: string | null }) => (
    <div data-testid="status" data-state={props.state} data-held={props.heldFrom ?? ""} />
  ),
}))

import OrderDetailPage from "@/app/(studio)/orders/[orderId]/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ orderId: "ord_1" }) }

const FROZEN = {
  configurationId: "cfg_1",
  materialId: "petg",
  colorId: "petg-black",
  dimensionsMm: { x: 10, y: 10, z: 10 },
  scaleFactor: 1,
  qualityId: "standard",
  strengthId: "everyday",
  shippingSpeed: "express",
  specialInstructions: "",
}

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    user_id: "u1",
    quote_id: "qt_1",
    status: "production_queued",
    payment_status: "paid",
    payment_ref: "pay_mock_ord_1",
    held_from_status: null,
    frozen_dv_id: "dv_1",
    frozen_config_json: FROZEN,
    contact_json: { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" },
    shipping_address_json: {
      line1: "12 Residency Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560025",
      country: "IN",
    },
    created_at: "2026-01-01",
    ...over,
  }
}

function seed(
  opts: {
    orders?: Record<string, unknown>[]
    quotes?: Record<string, unknown>[]
    dvs?: Record<string, unknown>[]
  } = {}
) {
  return createFakeDb({
    orders: { rows: opts.orders ?? [orderRow()], unique: ["id"] },
    quotes: {
      rows: opts.quotes ?? [
        {
          id: "qt_1",
          amount_minor: 24360,
          currency: "INR",
          breakdown_json: [
            { key: "material", label: "Material", amount: { amountMinor: 6000, currency: "INR" } },
          ],
          created_at: "1",
        },
      ],
      unique: ["id"],
    },
    design_versions: {
      rows: opts.dvs ?? [{ id: "dv_1", project_id: "proj_1", thumbnail_asset_id: "ast_thumb" }],
      unique: ["id"],
    },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("OrderDetailPage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(OrderDetailPage(ctx)).rejects.toThrow("redirect:/login")
  })

  it("404s for someone else's order", async () => {
    db = seed({ orders: [orderRow({ user_id: "u2" })] })
    await expect(OrderDetailPage(ctx)).rejects.toThrow("not-found")
  })

  it("404s when the order lookup fails", async () => {
    db.failNext({ message: "boom" })
    await expect(OrderDetailPage(ctx)).rejects.toThrow("not-found")
  })

  it("renders the frozen order, status track, address and payment reference", async () => {
    render(await OrderDetailPage(ctx))
    expect(screen.getByRole("heading", { name: /Order ord_1/ })).toBeInTheDocument()
    expect(screen.getByTestId("status")).toHaveAttribute("data-state", "production_queued")
    expect(screen.getByText("PETG")).toBeInTheDocument()
    expect(screen.getByText("₹243.60")).toBeInTheDocument()
    expect(screen.getByText(/12 Residency Road/)).toBeInTheDocument()
    expect(screen.getByText(/Bengaluru, Karnataka 560025/)).toBeInTheDocument()
    expect(screen.getByText(/pay_mock_ord_1/)).toBeInTheDocument()
  })

  it("passes the held-from state through for an order on hold", async () => {
    db = seed({ orders: [orderRow({ status: "on_hold", held_from_status: "printing" })] })
    render(await OrderDetailPage(ctx))
    expect(screen.getByTestId("status")).toHaveAttribute("data-held", "printing")
  })

  it("shows an optional second address line when one was stored", async () => {
    db = seed({
      orders: [
        orderRow({
          shipping_address_json: {
            line1: "12 Residency Road",
            line2: "Flat 3B",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560025",
            country: "IN",
          },
        }),
      ],
    })
    render(await OrderDetailPage(ctx))
    expect(screen.getByText(/Flat 3B/)).toBeInTheDocument()
  })

  it("still renders when the quote and design version can no longer be read", async () => {
    db = seed({ quotes: [], dvs: [] })
    render(await OrderDetailPage(ctx))
    expect(screen.getByText("₹0.00")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("still renders when the quote and design version queries fail", async () => {
    db.failCall(2, { message: "boom" })
    db.failCall(3, { message: "boom" })
    render(await OrderDetailPage(ctx))
    expect(screen.getByText("₹0.00")).toBeInTheDocument()
  })

  it("shows a dash when no payment reference has been recorded", async () => {
    db = seed({ orders: [orderRow({ payment_ref: null, status: "pending_payment" })] })
    render(await OrderDetailPage(ctx))
    expect(screen.getByText(/—/)).toBeInTheDocument()
  })
})
