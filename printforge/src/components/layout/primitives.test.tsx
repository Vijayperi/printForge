import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { Container, PageHeader, Section } from "@/src/components/layout/primitives"

describe("Container", () => {
  it("renders children with layout classes and merges className", () => {
    render(<Container className="extra">inside</Container>)
    const el = screen.getByText("inside")
    expect(el).toHaveAttribute("data-slot", "container")
    expect(el).toHaveClass("mx-auto", "extra")
  })
})

describe("Section", () => {
  it("renders a section element and merges className", () => {
    render(<Section className="extra">content</Section>)
    const el = screen.getByText("content")
    expect(el.tagName).toBe("SECTION")
    expect(el).toHaveClass("extra")
  })
})

describe("PageHeader", () => {
  it("renders the title as a heading", () => {
    render(<PageHeader title="Materials" />)
    expect(screen.getByRole("heading", { name: "Materials" })).toBeInTheDocument()
    expect(screen.queryByText("desc")).not.toBeInTheDocument()
  })

  it("renders the description when provided", () => {
    render(<PageHeader title="Materials" description="What we print with" />)
    expect(screen.getByText("What we print with")).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <PageHeader title="Hello" description="World" />
      </main>
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
