import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { MockCheckoutPanel } from "@/src/components/checkout/mock-checkout-panel"

const PAY = { rawBody: '{"type":"payment.succeeded"}', headers: { "webhook-id": "evt_pay" } }
const FAIL = { rawBody: '{"type":"payment.failed"}', headers: { "webhook-id": "evt_fail" } }

function renderPanel() {
  render(
    <MockCheckoutPanel
      orderId="ord_1"
      amountLabel="₹243.60"
      returnUrl="/orders/ord_1"
      pay={PAY}
      fail={FAIL}
    />
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "processed" }), { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("MockCheckoutPanel", () => {
  it("shows the order and amount it is standing in for", () => {
    renderPanel()
    expect(screen.getByRole("heading", { name: "Mock payment" })).toBeInTheDocument()
    expect(screen.getByText(/ord_1 — ₹243.60/)).toBeInTheDocument()
  })

  it("POSTs the signed success body byte-for-byte and returns to the order", async () => {
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: "Pay" }))

    expect(fetchMock).toHaveBeenCalledWith("/api/webhooks/dodo", {
      method: "POST",
      headers: { "webhook-id": "evt_pay", "content-type": "application/json" },
      body: PAY.rawBody,
    })
    expect(push).toHaveBeenCalledWith("/orders/ord_1")
  })

  it("POSTs the failure body when the fail button is used", async () => {
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: "Fail" }))
    expect(fetchMock.mock.calls[0]![1].body).toBe(FAIL.rawBody)
    expect(push).toHaveBeenCalledWith("/orders/ord_1")
  })

  it("surfaces a rejected webhook instead of navigating", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }))
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: "Pay" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Webhook rejected (401)")
    expect(push).not.toHaveBeenCalled()
  })

  it("disables both buttons while a webhook is in flight", async () => {
    let release: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      })
    )
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: "Pay" }))
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Fail" })).toBeDisabled()
    release(new Response("{}", { status: 200 }))
  })
})
