import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { Switch } from "@/src/components/ui/switch"

describe("Switch", () => {
  it("renders unchecked by default with the default size", () => {
    render(<Switch aria-label="Toggle" />)
    const el = screen.getByRole("switch", { name: "Toggle" })
    expect(el).not.toBeChecked()
    expect(el).toHaveAttribute("data-size", "default")
  })

  it("supports the small size and a custom className", () => {
    render(<Switch aria-label="Small" size="sm" className="extra" />)
    const el = screen.getByRole("switch", { name: "Small" })
    expect(el).toHaveAttribute("data-size", "sm")
    expect(el).toHaveClass("extra")
  })

  it("fires onCheckedChange when toggled", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Toggle" onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByRole("switch", { name: "Toggle" }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("reflects the controlled checked state", () => {
    render(<Switch aria-label="On" checked onCheckedChange={() => {}} />)
    expect(screen.getByRole("switch", { name: "On" })).toBeChecked()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<Switch aria-label="Accessible" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
