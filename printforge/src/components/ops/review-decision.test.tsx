import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import { ReviewDecision } from "@/src/components/ops/review-decision"

const fetchMock = vi.fn()

function reasonBox(): HTMLElement {
  return screen.getByLabelText(/vr_1/)
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "pass" }), { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("ReviewDecision", () => {
  it("blocks both decisions until a reason is given", async () => {
    const user = userEvent.setup()
    render(<ReviewDecision reportId="vr_1" />)
    expect(screen.getByRole("button", { name: "Approve for printing" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled()

    await user.type(reasonBox(), "walls measured fine")
    expect(screen.getByRole("button", { name: "Approve for printing" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled()
  })

  it("posts an approval with its reason and refreshes", async () => {
    const user = userEvent.setup()
    render(<ReviewDecision reportId="vr_1" />)
    await user.type(reasonBox(), "walls measured fine")
    await user.click(screen.getByRole("button", { name: "Approve for printing" }))

    expect(fetchMock).toHaveBeenCalledWith("/api/ops/validation-reports/vr_1/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", reason: "walls measured fine" }),
    })
    expect(refresh).toHaveBeenCalled()
  })

  it("posts a rejection", async () => {
    const user = userEvent.setup()
    render(<ReviewDecision reportId="vr_1" />)
    await user.type(reasonBox(), "too fragile")
    await user.click(screen.getByRole("button", { name: "Reject" }))
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      action: "reject",
      reason: "too fragile",
    })
  })

  it("reports a failure without refreshing", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 409 }))
    const user = userEvent.setup()
    render(<ReviewDecision reportId="vr_1" />)
    await user.type(reasonBox(), "already handled")
    await user.click(screen.getByRole("button", { name: "Reject" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be recorded")
    expect(refresh).not.toHaveBeenCalled()
  })
})
