import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { ViewerAnnouncer } from "@/src/viewer/controls/ViewerAnnouncer"

describe("ViewerAnnouncer", () => {
  it("announces the loading state", () => {
    render(<ViewerAnnouncer status="loading" mode="visual" />)
    const region = screen.getByRole("status")
    expect(region).toHaveAttribute("aria-live", "polite")
    expect(region).toHaveTextContent("Loading model…")
  })

  it("announces the error state", () => {
    render(<ViewerAnnouncer status="error" mode="visual" />)
    expect(screen.getByRole("status")).toHaveTextContent("Failed to load the model.")
  })

  it("announces ready with the current mode", () => {
    const { rerender } = render(<ViewerAnnouncer status="ready" mode="visual" />)
    expect(screen.getByRole("status")).toHaveTextContent("Model ready. Visual view.")
    rerender(<ViewerAnnouncer status="ready" mode="mesh" />)
    expect(screen.getByRole("status")).toHaveTextContent("Model ready. Technical mesh view.")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<ViewerAnnouncer status="ready" mode="visual" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
