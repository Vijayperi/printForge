import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { Input } from "@/src/components/ui/input"

describe("Input", () => {
  it("renders with the given type", () => {
    render(<Input type="email" aria-label="Email" />)
    const input = screen.getByRole("textbox", { name: "Email" })
    expect(input).toHaveAttribute("type", "email")
    expect(input).toHaveAttribute("data-slot", "input")
  })

  it("accepts typed text", async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Name" />)
    const input = screen.getByRole("textbox", { name: "Name" })
    await user.type(input, "PrintForge")
    expect(input).toHaveValue("PrintForge")
  })

  it("cannot be typed into when disabled", async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Locked" disabled defaultValue="keep" />)
    const input = screen.getByRole("textbox", { name: "Locked" })
    await user.type(input, "nope")
    expect(input).toHaveValue("keep")
    expect(input).toBeDisabled()
  })

  it("merges a custom className", () => {
    render(<Input aria-label="Styled" className="custom-input" />)
    expect(screen.getByRole("textbox", { name: "Styled" })).toHaveClass("custom-input")
  })

  it("has no accessibility violations with an associated label", async () => {
    const { container } = render(
      <div>
        <label htmlFor="the-input">Your prompt</label>
        <Input id="the-input" />
      </div>
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
