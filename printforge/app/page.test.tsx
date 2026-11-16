import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import Home from "@/app/page"
import { landingContent } from "@/src/config/content"

describe("Home page", () => {
  it("assembles every landing section in order", () => {
    render(<Home />)
    expect(
      screen.getByRole("heading", { level: 1, name: landingContent.hero.headline })
    ).toBeInTheDocument()
    const sectionIds = ["demo", "how-it-works", "examples", "materials", "faq"]
    const found = sectionIds.map((id) => document.getElementById(id))
    for (const el of found) expect(el).not.toBeNull()
    // Document order matches the funnel order.
    for (let i = 1; i < found.length; i += 1) {
      const prev = found[i - 1] as HTMLElement
      const curr = found[i] as HTMLElement
      expect(prev.compareDocumentPosition(curr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it("renders header and footer chrome", () => {
    render(<Home />)
    expect(screen.getByRole("banner")).toBeInTheDocument()
    expect(screen.getByRole("contentinfo")).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<Home />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
