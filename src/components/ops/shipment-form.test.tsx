import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import { ShipmentForm, type ShipmentView } from "@/src/components/ops/shipment-form"
import type { ShipmentStage } from "@/src/domain/ops/production"

const fetchMock = vi.fn()

beforeEach(() => {
  refresh.mockClear()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm(stage: ShipmentStage, shipment: ShipmentView | null = null) {
  return render(<ShipmentForm orderId="ord_1" stage={stage} shipment={shipment} />)
}

describe("ShipmentForm", () => {
  it("renders nothing while there is nothing to ship", () => {
    const { container } = renderForm("hidden")
    expect(container).toBeEmptyDOMElement()
  })

  it("asks for the quality check first", () => {
    renderForm("awaiting_qc")
    expect(screen.getByText(/record the quality check before shipping/i)).toBeInTheDocument()
    expect(screen.queryByLabelText("Tracking number")).not.toBeInTheDocument()
  })

  it("shows the recorded shipment once the order has shipped", () => {
    renderForm("hidden", { carrier: "blue_dart", trackingNumber: "BD123456" })
    expect(screen.getByText(/Blue Dart/)).toBeInTheDocument()
    expect(screen.getByText("BD123456")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /mark shipped/i })).not.toBeInTheDocument()
  })

  it("keeps the tracking number mandatory", () => {
    renderForm("ready")
    expect(screen.getByRole("button", { name: /mark shipped/i })).toBeDisabled()
  })

  it("ships the order with the chosen carrier and tracking number", async () => {
    const user = userEvent.setup()
    renderForm("ready")
    await user.selectOptions(screen.getByLabelText("Carrier"), "india_post")
    await user.type(screen.getByLabelText("Tracking number"), "IP-99887766")
    await user.click(screen.getByRole("button", { name: /mark shipped/i }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/orders/ord_1/shipment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ carrier: "india_post", trackingNumber: "IP-99887766" }),
      })
    )
  })

  it("defaults to the first configured carrier", async () => {
    const user = userEvent.setup()
    renderForm("ready")
    await user.type(screen.getByLabelText("Tracking number"), "DL1234")
    await user.click(screen.getByRole("button", { name: /mark shipped/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ carrier: "delhivery", trackingNumber: "DL1234" }),
    })
  })

  it("surfaces the server's reason for a refusal", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "illegal transition: printing –QC_PASSED→" } }),
    })
    renderForm("ready")
    await user.type(screen.getByLabelText("Tracking number"), "DL1234")
    await user.click(screen.getByRole("button", { name: /mark shipped/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("illegal transition")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the error body has no message", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    renderForm("ready")
    await user.type(screen.getByLabelText("Tracking number"), "DL1234")
    await user.click(screen.getByRole("button", { name: /mark shipped/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be recorded")
  })

  it("has no accessibility violations", async () => {
    const { container } = renderForm("ready")
    expect(await axe(container)).toHaveNoViolations()
  })
})
