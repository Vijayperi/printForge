import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { Badge, badgeVariants } from "@/src/components/ui/badge"

const VARIANTS = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const

describe("Badge", () => {
  it("renders a span with the default variant", () => {
    render(<Badge>New</Badge>)
    const badge = screen.getByText("New")
    expect(badge.tagName).toBe("SPAN")
    expect(badge).toHaveAttribute("data-slot", "badge")
    expect(badge).toHaveAttribute("data-variant", "default")
  })

  it.each(VARIANTS.map((v) => [v] as const))("renders the %s variant", (variant) => {
    render(<Badge variant={variant}>B</Badge>)
    expect(screen.getByText("B")).toHaveAttribute("data-variant", variant)
  })

  it("renders as its child with asChild", () => {
    render(
      <Badge asChild>
        <a href="/x">Linked badge</a>
      </Badge>
    )
    const link = screen.getByRole("link", { name: "Linked badge" })
    expect(link).toHaveAttribute("data-slot", "badge")
  })

  it("merges a custom className", () => {
    render(<Badge className="extra">C</Badge>)
    expect(screen.getByText("C")).toHaveClass("extra")
  })

  it("badgeVariants composes classes", () => {
    expect(badgeVariants({ variant: "secondary" })).toContain("bg-secondary")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<Badge>OK</Badge>)
    expect(await axe(container)).toHaveNoViolations()
  })
})
