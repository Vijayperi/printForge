import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import { availableActions, ReviewActions } from "@/src/components/ops/review-actions"
import type { OrderState } from "@/src/domain/stateMachines/order"

const fetchMock = vi.fn()

function renderActions(state: OrderState, heldFrom: OrderState | null = null) {
  render(<ReviewActions orderId="ord_1" state={state} heldFrom={heldFrom} />)
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("availableActions", () => {
  it("offers approve, reject and hold in design review", () => {
    expect(availableActions("design_review", null)).toEqual(["approve", "reject", "hold"])
  })

  it("offers only hold while printing", () => {
    expect(availableActions("printing", null)).toEqual(["hold"])
  })

  it("offers a release only when a hold has a recorded origin", () => {
    expect(availableActions("on_hold", "printing")).toEqual(["release_hold"])
    expect(availableActions("on_hold", null)).toEqual([])
  })

  it("offers nothing on a terminal order", () => {
    expect(availableActions("cancelled", null)).toEqual([])
    expect(availableActions("delivered", null)).toEqual([])
  })
})

describe("ReviewActions", () => {
  it("says so when no action applies", () => {
    renderActions("delivered")
    expect(screen.getByText("No review actions apply in this state.")).toBeInTheDocument()
  })

  it("keeps confirm disabled until a reason is typed", async () => {
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Approve" }))

    const confirm = screen.getByRole("button", { name: "Confirm" })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText(/Reason/), "geometry checks out")
    expect(confirm).toBeEnabled()
  })

  it("posts the action and reason, then refreshes", async () => {
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Reject & refund" }))
    await user.type(screen.getByLabelText(/Reason/), "unprintable walls")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    expect(fetchMock).toHaveBeenCalledWith("/api/ops/orders/ord_1/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject", reason: "unprintable walls" }),
    })
    expect(refresh).toHaveBeenCalled()
  })

  it("surfaces the server's refusal and stays open", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "illegal transition" } }), { status: 409 })
    )
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Approve" }))
    await user.type(screen.getByLabelText(/Reason/), "go")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("illegal transition")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the server explains nothing", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }))
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Approve" }))
    await user.type(screen.getByLabelText(/Reason/), "go")
    await user.click(screen.getByRole("button", { name: "Confirm" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be applied")
  })

  it("clears the draft reason when cancelled", async () => {
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Approve" }))
    await user.type(screen.getByLabelText(/Reason/), "typed then abandoned")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    await user.click(screen.getByRole("button", { name: "Approve" }))
    expect(screen.getByLabelText(/Reason/)).toHaveValue("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("closes when the dialog is dismissed", async () => {
    const user = userEvent.setup()
    renderActions("design_review")
    await user.click(screen.getByRole("button", { name: "Approve" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
