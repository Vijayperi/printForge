import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { CheckoutForm } from "@/src/components/checkout/checkout-form"

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Full name"), "Asha Rao")
  await user.type(screen.getByLabelText("Email"), "asha@example.com")
  await user.type(screen.getByLabelText("Mobile number"), "98765 43210")
  await user.type(screen.getByLabelText("Address line 1"), "12 Residency Road")
  await user.type(screen.getByLabelText("City"), "Bengaluru")
  await user.selectOptions(screen.getByLabelText("State"), "Karnataka")
  await user.type(screen.getByLabelText("PIN code"), "560025")
}

function submitted(): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(
    jsonResponse(201, { orderId: "ord_1", checkoutUrl: "/mock-checkout/cks_mock_ord_1" })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("CheckoutForm", () => {
  it("posts only the quote, contact and address — never an amount", async () => {
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))

    expect(fetchMock).toHaveBeenCalledWith("/api/checkout/session", expect.anything())
    expect(Object.keys(submitted()).sort()).toEqual(["contact", "quoteId", "shippingAddress"])
    expect(submitted()).toEqual({
      quoteId: "qt_1",
      contact: { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" },
      shippingAddress: {
        line1: "12 Residency Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560025",
        country: "IN",
      },
    })
  })

  it("redirects to the hosted checkout the server hands back", async () => {
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))
    expect(push).toHaveBeenCalledWith("/mock-checkout/cks_mock_ord_1")
  })

  it("includes a second address line when one is given", async () => {
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.type(screen.getByLabelText("Address line 2 (optional)"), "Flat 3B")
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))
    expect((submitted().shippingAddress as { line2?: string }).line2).toBe("Flat 3B")
  })

  it("shows field errors and never calls the server when the form is invalid", async () => {
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await user.type(screen.getByLabelText("Full name"), "Asha Rao")
    await user.type(screen.getByLabelText("Email"), "not-an-email")
    await user.type(screen.getByLabelText("Mobile number"), "12345")
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText("enter a valid email address")).toBeInTheDocument()
    expect(screen.getByText("enter a 10-digit Indian mobile number")).toBeInTheDocument()
    expect(screen.getByText("enter a 6-digit PIN code")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true")
  })

  it("surfaces the server's reason when checkout cannot be opened", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "conflict", message: "this quote has expired" } })
    )
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("this quote has expired")
    expect(push).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the server explains nothing", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}))
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t open checkout")
  })

  it("treats a 2xx without a checkout url as a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { orderId: "ord_1" }))
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it("disables the form while the session is being opened", async () => {
    let release: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      })
    )
    const user = userEvent.setup()
    render(<CheckoutForm quoteId="qt_1" />)
    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Pay with Dodo" }))

    expect(screen.getByRole("button", { name: "Opening secure checkout…" })).toBeDisabled()
    expect(screen.getByLabelText("Full name")).toBeDisabled()
    release(jsonResponse(201, { orderId: "ord_1", checkoutUrl: "/x" }))
  })
})
