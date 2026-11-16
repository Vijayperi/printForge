import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Separator } from "@/src/components/ui/separator"

describe("Separator", () => {
  it("renders a decorative horizontal separator by default", () => {
    const { container } = render(<Separator />)
    const el = container.querySelector('[data-slot="separator"]')
    expect(el).toHaveAttribute("data-orientation", "horizontal")
    expect(el).toHaveAttribute("role", "none")
  })

  it("renders a vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.querySelector('[data-slot="separator"]')).toHaveAttribute(
      "data-orientation",
      "vertical"
    )
  })

  it("renders a semantic separator when not decorative", () => {
    const { getByRole } = render(<Separator decorative={false} />)
    expect(getByRole("separator")).toBeInTheDocument()
  })

  it("merges a custom className", () => {
    const { container } = render(<Separator className="extra" />)
    expect(container.querySelector('[data-slot="separator"]')).toHaveClass("extra")
  })
})
