import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { OrderSummary } from "@/src/components/checkout/order-summary"
import type { FrozenConfig } from "@/src/domain/checkout/frozenConfig"

const config: FrozenConfig = {
  configurationId: "cfg_1",
  materialId: "pla",
  colorId: "pla-white",
  dimensionsMm: { x: 40.04, y: 20, z: 10 },
  scaleFactor: 1,
  qualityId: "standard",
  strengthId: "everyday",
  shippingSpeed: "standard",
  specialInstructions: "",
}

const breakdown = [
  { key: "material", label: "Material", amount: { amountMinor: 6000, currency: "INR" as const } },
  { key: "machine", label: "Machine time", amount: { amountMinor: 12000, currency: "INR" as const } },
]

function renderSummary(over: Partial<React.ComponentProps<typeof OrderSummary>> = {}) {
  render(
    <OrderSummary
      heading="Your order"
      thumbnailAssetId={null}
      config={config}
      breakdown={breakdown}
      totalMinor={18000}
      totalLabel="Total payable"
      {...over}
    />
  )
}

describe("OrderSummary", () => {
  it("names the material, colour and presets rather than their ids", () => {
    renderSummary()
    expect(screen.getByRole("heading", { name: "Your order" })).toBeInTheDocument()
    expect(screen.getByText("PLA")).toBeInTheDocument()
    expect(screen.getByText("White")).toBeInTheDocument()
    expect(screen.getByText("40 × 20 × 10 mm")).toBeInTheDocument()
  })

  it("falls back to the raw id for a preset we no longer publish", () => {
    renderSummary({ config: { ...config, qualityId: "retired", colorId: "gone" } })
    expect(screen.getByText("retired")).toBeInTheDocument()
    expect(screen.getByText("gone")).toBeInTheDocument()
  })

  it("renders the price breakdown and total in rupees", () => {
    renderSummary()
    expect(screen.getByText("₹60.00")).toBeInTheDocument()
    expect(screen.getByText("₹120.00")).toBeInTheDocument()
    expect(screen.getByText("₹180.00")).toBeInTheDocument()
  })

  it("shows the thumbnail when the design version has one", () => {
    renderSummary({ thumbnailAssetId: "ast_thumb" })
    expect(screen.getByRole("img", { name: "Model thumbnail" })).toHaveAttribute(
      "src",
      "/api/assets/ast_thumb"
    )
  })

  it("shows a placeholder when there is no thumbnail", () => {
    renderSummary()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText("3D")).toBeInTheDocument()
  })

  it("omits the size row when no dimensions were frozen", () => {
    renderSummary({ config: { ...config, dimensionsMm: null } })
    expect(screen.queryByText("Size")).not.toBeInTheDocument()
  })

  it("shows special instructions only when there are some", () => {
    renderSummary()
    expect(screen.queryByText(/Notes:/)).not.toBeInTheDocument()
    renderSummary({ config: { ...config, specialInstructions: "Sand the base" } })
    expect(screen.getByText("Sand the base")).toBeInTheDocument()
  })
})
