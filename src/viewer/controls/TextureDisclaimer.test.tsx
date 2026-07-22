import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { TextureDisclaimer } from "@/src/viewer/controls/TextureDisclaimer"

describe("TextureDisclaimer", () => {
  it("renders the FDM texture-fidelity disclaimer", () => {
    render(<TextureDisclaimer />)
    expect(screen.getByText(/single filament colour/)).toBeInTheDocument()
  })

  it("merges a custom className", () => {
    render(<TextureDisclaimer className="mt-4" />)
    expect(screen.getByText(/single filament colour/)).toHaveClass("mt-4")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<TextureDisclaimer />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
