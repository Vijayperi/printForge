import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { DimensionReadout } from "@/src/viewer/controls/DimensionReadout"

describe("DimensionReadout", () => {
  it("shows a placeholder when dimensions are unavailable", () => {
    render(<DimensionReadout dimensionsMm={null} />)
    expect(screen.getByText("Dimensions unavailable")).toBeInTheDocument()
  })

  it("renders width, height, and depth rounded to one decimal", () => {
    render(<DimensionReadout dimensionsMm={{ x: 20.04, y: 40, z: 6 }} />)
    expect(screen.getByRole("group", { name: "Model dimensions" })).toBeInTheDocument()
    expect(screen.getByText("20.0 mm")).toBeInTheDocument()
    expect(screen.getByText("40.0 mm")).toBeInTheDocument()
    expect(screen.getByText("6.0 mm")).toBeInTheDocument()
    expect(screen.getByText("Width:")).toBeInTheDocument()
    expect(screen.getByText("Height:")).toBeInTheDocument()
    expect(screen.getByText("Depth:")).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<DimensionReadout dimensionsMm={{ x: 10, y: 20, z: 30 }} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
