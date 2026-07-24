import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { formatDuration, formatExpiry, QuotePanel, type QuoteDto } from "@/src/components/studio/quote-panel"

const QUOTE: QuoteDto = {
  id: "qt_1",
  amountMinor: 24360,
  currency: "INR",
  breakdown: [
    { key: "material", label: "Material", amount: { amountMinor: 6000, currency: "INR" } },
    { key: "shipping", label: "Shipping", amount: { amountMinor: 6000, currency: "INR" } },
  ],
  slice: { durationMinutes: 90, materialGrams: 20, supportsUsed: false },
  expiresAt: "2026-07-25T00:00:00.000Z",
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("formatDuration", () => {
  it("humanises minutes", () => {
    expect(formatDuration(150)).toBe("2h 30m")
    expect(formatDuration(45)).toBe("45m")
    expect(formatDuration(120)).toBe("2h")
    expect(formatDuration(0)).toBe("0m")
  })
})

describe("formatExpiry", () => {
  it("formats an ISO timestamp deterministically in UTC", () => {
    expect(formatExpiry("2026-07-25T09:30:00.000Z")).toContain("2026")
    expect(formatExpiry("2026-07-25T09:30:00.000Z")).toContain("09:30")
  })
})

describe("QuotePanel", () => {
  it("shows the idle state with a Get a quote button", () => {
    vi.stubGlobal("fetch", vi.fn())
    render(<QuotePanel designVersionId="dv_1" />)
    expect(screen.getByRole("button", { name: "Get a quote" })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("requests and renders a ready quote breakdown", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready", quote: QUOTE })))
    render(<QuotePanel designVersionId="dv_1" />)
    await user.click(screen.getByRole("button", { name: "Get a quote" }))

    expect(await screen.findByText("Total (incl. taxes where applicable)")).toBeInTheDocument()
    expect(screen.getByText("₹243.60")).toBeInTheDocument()
    expect(screen.getAllByText("₹60.00")).toHaveLength(2) // material + shipping lines
    expect(screen.getByText("1h 30m")).toBeInTheDocument() // duration
    expect(screen.getAllByText(/business days/)).toHaveLength(2) // production + delivery
    expect(screen.getByRole("button", { name: "Proceed to checkout" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Refresh quote" })).toBeInTheDocument()
  })

  it("omits the print-time row when the slice is unavailable", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready", quote: { ...QUOTE, slice: null } })))
    render(<QuotePanel designVersionId="dv_1" />)
    await user.click(screen.getByRole("button", { name: "Get a quote" }))
    await screen.findByText("Total (incl. taxes where applicable)")
    expect(screen.queryByText("Estimated print time")).not.toBeInTheDocument()
  })

  it("shows an unavailable message when the model can't be quoted", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(412, { error: { code: "precondition_failed", message: "this model isn’t printable yet" } })))
    render(<QuotePanel designVersionId="dv_1" />)
    await user.click(screen.getByRole("button", { name: "Get a quote" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn’t printable/)
  })

  it("falls back to a generic message when the error body has none", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, {})))
    render(<QuotePanel designVersionId="dv_1" />)
    await user.click(screen.getByRole("button", { name: "Get a quote" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/can’t be quoted/)
  })

  it("shows the slicing skeleton on 202 and polls (rescheduling) until the quote lands", async () => {
    vi.useFakeTimers()
    const responses = [
      jsonResponse(202, { status: "pending_slice" }), // POST
      jsonResponse(500, {}), // GET #1: not ok → reschedule
      jsonResponse(200, { status: "none" }), // GET #2: still slicing → reschedule
      jsonResponse(200, { status: "ready", quote: QUOTE }), // GET #3: ready
    ]
    let i = 0
    vi.stubGlobal("fetch", vi.fn(async () => responses[i++]!))
    render(<QuotePanel designVersionId="dv_1" />)

    fireEvent.click(screen.getByRole("button", { name: "Get a quote" }))
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/Slicing your model/)).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    vi.useRealTimers()
    await screen.findByText("Total (incl. taxes where applicable)")
  })

  it("does not update state after unmount during the POST", async () => {
    let resolvePost: (r: Response) => void = () => {}
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolvePost = r))))
    const { unmount } = render(<QuotePanel designVersionId="dv_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Get a quote" }))
    unmount()
    resolvePost(jsonResponse(200, { status: "ready", quote: QUOTE }))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText("Total (incl. taxes where applicable)")).not.toBeInTheDocument()
  })

  it("stops polling after unmount", async () => {
    let resolveGet: (r: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "POST"
          ? Promise.resolve(jsonResponse(202, { status: "pending_slice" }))
          : new Promise<Response>((r) => (resolveGet = r))
      )
    )
    const { unmount } = render(<QuotePanel designVersionId="dv_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Get a quote" }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    unmount()
    resolveGet(jsonResponse(200, { status: "ready", quote: QUOTE }))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText("Total (incl. taxes where applicable)")).not.toBeInTheDocument()
  })

  it("has no accessibility violations in the ready state", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready", quote: QUOTE })))
    const { container } = render(<QuotePanel designVersionId="dv_1" />)
    await user.click(screen.getByRole("button", { name: "Get a quote" }))
    await screen.findByText("Total (incl. taxes where applicable)")
    expect(await axe(container)).toHaveNoViolations()
  })
})
