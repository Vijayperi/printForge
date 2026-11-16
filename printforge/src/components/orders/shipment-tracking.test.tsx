import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { ShipmentTracking } from "@/src/components/orders/shipment-tracking"

describe("ShipmentTracking", () => {
  it("renders nothing until a shipment exists", () => {
    const { container } = render(<ShipmentTracking shipment={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the carrier by its display name and the tracking number", () => {
    render(<ShipmentTracking shipment={{ carrier: "dtdc", trackingNumber: "DT-4455" }} />)
    expect(screen.getByRole("heading", { name: "Tracking" })).toBeInTheDocument()
    expect(screen.getByText("DTDC")).toBeInTheDocument()
    expect(screen.getByText("DT-4455")).toBeInTheDocument()
  })

  it("falls back to the stored carrier id when it is not one we know", () => {
    render(<ShipmentTracking shipment={{ carrier: "some_courier", trackingNumber: "X1" }} />)
    expect(screen.getByText("some_courier")).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ShipmentTracking shipment={{ carrier: "delhivery", trackingNumber: "DL1" }} />
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
