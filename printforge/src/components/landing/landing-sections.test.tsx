import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { CtaBand } from "@/src/components/landing/cta-band"
import { DemoSlot } from "@/src/components/landing/demo-slot"
import { ExamplesGrid } from "@/src/components/landing/examples-grid"
import { FaqAccordion } from "@/src/components/landing/faq-accordion"
import { Hero } from "@/src/components/landing/hero"
import { MaterialsOverview } from "@/src/components/landing/materials-overview"
import { SiteFooter } from "@/src/components/landing/site-footer"
import { ThreeStepExplainer } from "@/src/components/landing/three-step-explainer"
import { landingContent } from "@/src/config/content"

describe("Hero", () => {
  it("renders the headline, subheadline, and prompt CTA", () => {
    render(<Hero />)
    expect(
      screen.getByRole("heading", { level: 1, name: landingContent.hero.headline })
    ).toBeInTheDocument()
    expect(screen.getByText(landingContent.hero.subheadline)).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: landingContent.hero.promptPlaceholder })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: landingContent.hero.primaryCta })).toBeInTheDocument()
  })

  it("links the secondary CTA to the examples section", () => {
    render(<Hero />)
    expect(screen.getByRole("link", { name: landingContent.hero.secondaryCta })).toHaveAttribute(
      "href",
      "#examples"
    )
  })

  it("submits the prompt toward the projects flow", () => {
    render(<Hero />)
    const form = screen.getByRole("search")
    expect(form).toHaveAttribute("action", "/projects")
  })
})

describe("DemoSlot", () => {
  it("renders the demo placeholder with its stable id", () => {
    render(<DemoSlot />)
    const section = screen.getByRole("region", { name: "3D preview demo" })
    expect(section).toHaveAttribute("id", "demo")
    expect(within(section).getByText(/Interactive 3D preview/)).toBeInTheDocument()
  })
})

describe("ThreeStepExplainer", () => {
  it("renders all three steps in order", () => {
    render(<ThreeStepExplainer />)
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(3)
    landingContent.steps.forEach((step, i) => {
      expect(within(items[i] as HTMLElement).getByText(step.title)).toBeInTheDocument()
      expect(within(items[i] as HTMLElement).getByText(step.description)).toBeInTheDocument()
    })
  })
})

describe("ExamplesGrid", () => {
  it("renders every example object with its use case", () => {
    render(<ExamplesGrid />)
    for (const example of landingContent.examples) {
      expect(screen.getByText(example.title)).toBeInTheDocument()
      expect(screen.getByText(example.useCase)).toBeInTheDocument()
    }
  })
})

describe("MaterialsOverview", () => {
  it("renders each material with its colour swatches", () => {
    render(<MaterialsOverview />)
    for (const material of landingContent.materials) {
      expect(screen.getByText(material.name)).toBeInTheDocument()
      const list = screen.getByRole("list", { name: `${material.name} colours` })
      expect(within(list).getAllByRole("listitem")).toHaveLength(material.colorHexes.length)
    }
  })

  it("shows the INR starting price and the texture disclaimer", () => {
    render(<MaterialsOverview />)
    expect(screen.getByText(/Starting from ₹499\.00/)).toBeInTheDocument()
    expect(screen.getByText(/visual preview/)).toBeInTheDocument()
  })
})

describe("FaqAccordion", () => {
  it("renders every FAQ question as a collapsed trigger", () => {
    render(<FaqAccordion />)
    for (const faq of landingContent.faqs) {
      expect(screen.getByRole("button", { name: faq.question })).toHaveAttribute(
        "aria-expanded",
        "false"
      )
    }
  })
})

describe("CtaBand", () => {
  it("links both calls to action", () => {
    render(<CtaBand />)
    expect(screen.getByRole("link", { name: landingContent.hero.primaryCta })).toHaveAttribute(
      "href",
      "/projects"
    )
    expect(screen.getByRole("link", { name: landingContent.hero.secondaryCta })).toHaveAttribute(
      "href",
      "#examples"
    )
  })
})

describe("SiteFooter", () => {
  it("renders the delivery notice and all policy links", () => {
    render(<SiteFooter />)
    expect(screen.getByText(landingContent.deliveryNotice)).toBeInTheDocument()
    for (const policy of landingContent.policies) {
      expect(screen.getByRole("link", { name: policy.label })).toHaveAttribute("href", policy.href)
    }
  })

  it("renders the current year in the disclaimer", () => {
    render(<SiteFooter />)
    expect(
      screen.getByText(new RegExp(`© ${new Date().getFullYear()} ${landingContent.brand}`))
    ).toBeInTheDocument()
  })
})

describe("landing sections accessibility", () => {
  it.each([
    ["Hero", Hero],
    ["DemoSlot", DemoSlot],
    ["ThreeStepExplainer", ThreeStepExplainer],
    ["ExamplesGrid", ExamplesGrid],
    ["MaterialsOverview", MaterialsOverview],
    ["FaqAccordion", FaqAccordion],
    ["CtaBand", CtaBand],
  ] as const)("%s has no accessibility violations", async (_name, Component) => {
    const { container } = render(
      <main>
        <Component />
      </main>
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it("SiteFooter has no accessibility violations", async () => {
    const { container } = render(<SiteFooter />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
