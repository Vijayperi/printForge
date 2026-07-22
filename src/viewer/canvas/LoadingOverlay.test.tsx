import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LoadingOverlay } from "@/src/viewer/canvas/LoadingOverlay"

describe("LoadingOverlay", () => {
  it("shows rounded progress while loading", () => {
    render(<LoadingOverlay status="loading" progress={42.6} />)
    expect(screen.getByText("Loading model… 43%")).toBeInTheDocument()
  })

  it("shows an alert on error", () => {
    render(<LoadingOverlay status="error" progress={0} />)
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load the 3D model/i)
  })

  it("renders nothing once ready", () => {
    const { container } = render(<LoadingOverlay status="ready" progress={100} />)
    expect(container).toBeEmptyDOMElement()
  })
})
