import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { Textarea } from "@/src/components/ui/textarea"

describe("Textarea", () => {
  it("renders and accepts typed text", async () => {
    const user = userEvent.setup()
    render(<Textarea aria-label="Prompt" />)
    const el = screen.getByRole("textbox", { name: "Prompt" })
    expect(el).toHaveAttribute("data-slot", "textarea")
    await user.type(el, "a dinosaur")
    expect(el).toHaveValue("a dinosaur")
  })

  it("cannot be typed into when disabled", async () => {
    const user = userEvent.setup()
    render(<Textarea aria-label="Locked" disabled defaultValue="keep" />)
    const el = screen.getByRole("textbox", { name: "Locked" })
    await user.type(el, "no")
    expect(el).toHaveValue("keep")
  })

  it("merges a custom className", () => {
    render(<Textarea aria-label="Styled" className="extra" />)
    expect(screen.getByRole("textbox", { name: "Styled" })).toHaveClass("extra")
  })

  it("has no accessibility violations with a label", async () => {
    const { container } = render(
      <div>
        <label htmlFor="t">Prompt</label>
        <Textarea id="t" />
      </div>
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
