import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import Home from "@/app/page"

describe("Home page", () => {
  it("renders the hero headline and tagline", () => {
    render(<Home />)
    expect(screen.getByText("PrintForge")).toBeInTheDocument()
    expect(screen.getByText("Describe it. See it. We print it.")).toBeInTheDocument()
  })

  it("renders both calls to action as links", () => {
    render(<Home />)
    expect(screen.getByRole("link", { name: "Start creating" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "See examples" })).toHaveAttribute("href", "/")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<Home />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
