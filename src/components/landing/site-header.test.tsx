import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { SiteHeader } from "@/src/components/landing/site-header"
import { landingContent } from "@/src/config/content"

describe("SiteHeader", () => {
  it("renders the brand as a home link", () => {
    render(<SiteHeader />)
    expect(screen.getByRole("link", { name: landingContent.brand })).toHaveAttribute("href", "/")
  })

  it("renders desktop navigation with section anchors and the CTA", () => {
    render(<SiteHeader />)
    const nav = screen.getByRole("navigation", { name: "Main" })
    expect(within(nav).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "#faq")
    expect(within(nav).getByRole("link", { name: "Examples" })).toHaveAttribute("href", "#examples")
    expect(within(nav).getByRole("link", { name: "Materials" })).toHaveAttribute("href", "#materials")
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#how-it-works"
    )
    expect(within(nav).getByRole("link", { name: landingContent.hero.primaryCta })).toHaveAttribute(
      "href",
      "/projects"
    )
  })

  it("toggles the mobile menu open and closed", async () => {
    const user = userEvent.setup()
    render(<SiteHeader />)
    const toggle = screen.getByRole("button", { name: "Menu" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    await user.click(toggle)
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true")
    const mobileNav = screen.getByRole("navigation", { name: "Main mobile" })
    expect(mobileNav).toHaveClass("block")

    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false")
    expect(mobileNav).toHaveClass("hidden")
  })

  it("closes the mobile menu after choosing a link", async () => {
    const user = userEvent.setup()
    render(<SiteHeader />)
    await user.click(screen.getByRole("button", { name: "Menu" }))
    const mobileNav = screen.getByRole("navigation", { name: "Main mobile" })
    await user.click(within(mobileNav).getByRole("link", { name: "FAQ" }))
    expect(mobileNav).toHaveClass("hidden")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<SiteHeader />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
