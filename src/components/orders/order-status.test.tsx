import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import { OrderStatus, PENDING_POLL_MS } from "@/src/components/orders/order-status"

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("OrderStatus", () => {
  it("marks the current step and keeps the customer labels", () => {
    render(<OrderStatus state="printing" heldFrom={null} />)
    const current = screen.getByRole("listitem", { current: "step" })
    expect(current).toHaveTextContent("Printing")
    expect(screen.getByText("Paid — preparing for production")).toBeInTheDocument()
  })

  it("explains the interim state while payment is being confirmed", () => {
    render(<OrderStatus state="pending_payment" heldFrom={null} />)
    expect(screen.getByRole("status")).toHaveTextContent("Confirming your payment")
  })

  it("refreshes itself until the webhook settles a pending order", () => {
    render(<OrderStatus state="pending_payment" heldFrom={null} />)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PENDING_POLL_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("stops refreshing once the order is settled", () => {
    render(<OrderStatus state="paid" heldFrom={null} />)
    vi.advanceTimersByTime(PENDING_POLL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("clears its timer on unmount", () => {
    const { unmount } = render(<OrderStatus state="pending_payment" heldFrom={null} />)
    unmount()
    vi.advanceTimersByTime(PENDING_POLL_MS * 3)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("calls out an on-hold order and shows where it stopped", () => {
    render(<OrderStatus state="on_hold" heldFrom="production_queued" />)
    expect(screen.getByRole("alert")).toHaveTextContent("On hold")
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Queued")
  })

  it("calls out a cancelled order with no position on the track", () => {
    render(<OrderStatus state="cancelled" heldFrom={null} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Cancelled")
    expect(screen.queryByRole("listitem", { current: "step" })).not.toBeInTheDocument()
  })
})
