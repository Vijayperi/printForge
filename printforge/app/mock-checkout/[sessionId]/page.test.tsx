import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

let env: { NODE_ENV: string; PAYMENT_PROVIDER: string }
vi.mock("@/src/config/env", () => ({ getEnv: () => env }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

vi.mock("@/src/components/checkout/mock-checkout-panel", () => ({
  MockCheckoutPanel: (props: { orderId: string; amountLabel: string; returnUrl: string; pay: { rawBody: string }; fail: { rawBody: string } }) => (
    <div
      data-testid="panel"
      data-order={props.orderId}
      data-amount={props.amountLabel}
      data-return={props.returnUrl}
      data-pay={props.pay.rawBody}
      data-fail={props.fail.rawBody}
    />
  ),
}))

import MockCheckoutPage from "@/app/mock-checkout/[sessionId]/page"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const ctx = (sessionId = "cks_mock_ord_1") => ({ params: Promise.resolve({ sessionId }) })

function seed(
  opts: { orders?: Record<string, unknown>[]; quotes?: Record<string, unknown>[] } = {}
) {
  return createFakeDb({
    orders: {
      rows: opts.orders ?? [{ id: "ord_1", user_id: "u1", quote_id: "qt_1", created_at: "1" }],
      unique: ["id"],
    },
    quotes: {
      rows: opts.quotes ?? [{ id: "qt_1", amount_minor: 24360, currency: "INR", created_at: "1" }],
      unique: ["id"],
    },
  })
}

beforeEach(() => {
  env = { NODE_ENV: "development", PAYMENT_PROVIDER: "mock" }
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("MockCheckoutPage", () => {
  it("404s in production", async () => {
    env = { NODE_ENV: "production", PAYMENT_PROVIDER: "mock" }
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when a real payment provider is configured", async () => {
    env = { NODE_ENV: "development", PAYMENT_PROVIDER: "dodo" }
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s for a session id that is not a mock session", async () => {
    await expect(MockCheckoutPage(ctx("cks_live_abc"))).rejects.toThrow("not-found")
  })

  it("404s when the order does not exist", async () => {
    db = seed({ orders: [] })
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the order lookup fails", async () => {
    db.failNext({ message: "boom" })
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the quote is gone", async () => {
    db = seed({ quotes: [] })
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the quote lookup fails", async () => {
    db.failCall(2, { message: "boom" })
    await expect(MockCheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("renders signed success and failure webhooks for the order", async () => {
    render(await MockCheckoutPage(ctx()))
    const panel = screen.getByTestId("panel")
    expect(panel).toHaveAttribute("data-order", "ord_1")
    expect(panel).toHaveAttribute("data-amount", "₹243.60")
    expect(panel).toHaveAttribute("data-return", "/orders/ord_1")

    const pay = JSON.parse(panel.getAttribute("data-pay") as string) as {
      type: string
      data: { total_amount: number; metadata: Record<string, string> }
    }
    expect(pay.type).toBe("payment.succeeded")
    expect(pay.data.total_amount).toBe(24360)
    expect(pay.data.metadata).toEqual({ order_id: "ord_1", quote_id: "qt_1" })

    const fail = JSON.parse(panel.getAttribute("data-fail") as string) as { type: string }
    expect(fail.type).toBe("payment.failed")
  })
})
