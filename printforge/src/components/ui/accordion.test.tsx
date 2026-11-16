import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/src/components/ui/accordion"

function renderAccordion() {
  return render(
    <Accordion type="single" collapsible>
      <AccordionItem value="one">
        <AccordionTrigger>First question</AccordionTrigger>
        <AccordionContent>First answer</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two" className="second-item">
        <AccordionTrigger className="second-trigger">Second question</AccordionTrigger>
        <AccordionContent className="second-content">Second answer</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

describe("Accordion", () => {
  it("renders triggers collapsed by default", () => {
    renderAccordion()
    expect(screen.getByRole("button", { name: "First question" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
    expect(screen.queryByText("First answer")).not.toBeInTheDocument()
  })

  it("expands on click and collapses again", async () => {
    const user = userEvent.setup()
    renderAccordion()
    const trigger = screen.getByRole("button", { name: "First question" })
    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("First answer")).toBeVisible()
    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("only opens one item at a time in single mode", async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.click(screen.getByRole("button", { name: "First question" }))
    await user.click(screen.getByRole("button", { name: "Second question" }))
    expect(screen.queryByText("First answer")).not.toBeInTheDocument()
    expect(screen.getByText("Second answer")).toBeVisible()
  })

  it("is keyboard operable", async () => {
    const user = userEvent.setup()
    renderAccordion()
    screen.getByRole("button", { name: "First question" }).focus()
    await user.keyboard("{Enter}")
    expect(screen.getByText("First answer")).toBeVisible()
  })

  it("merges custom classNames on item, trigger, and content", async () => {
    const user = userEvent.setup()
    renderAccordion()
    const trigger = screen.getByRole("button", { name: "Second question" })
    expect(trigger).toHaveClass("second-trigger")
    await user.click(trigger)
    expect(screen.getByText("Second answer")).toHaveClass("second-content")
  })

  it("has no accessibility violations", async () => {
    const { container } = renderAccordion()
    expect(await axe(container)).toHaveNoViolations()
  })
})
