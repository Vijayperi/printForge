import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { Button, buttonVariants } from "@/src/components/ui/button"

const VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const
const SIZES = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"] as const

describe("Button", () => {
  it("renders a native button with default variant and size", () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole("button", { name: "Click me" })
    expect(button).toHaveAttribute("data-slot", "button")
    expect(button).toHaveAttribute("data-variant", "default")
    expect(button).toHaveAttribute("data-size", "default")
  })

  it.each(VARIANTS.map((v) => [v] as const))("renders the %s variant", (variant) => {
    render(<Button variant={variant}>V</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", variant)
  })

  it.each(SIZES.map((s) => [s] as const))("renders the %s size", (size) => {
    render(<Button size={size}>S</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("data-size", size)
  })

  it("fires onClick when activated by mouse and keyboard", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.click(screen.getByRole("button"))
    screen.getByRole("button").focus()
    await user.keyboard("{Enter}")
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Nope
      </Button>
    )
    await user.click(screen.getByRole("button"))
    expect(onClick).not.toHaveBeenCalled()
  })

  it("renders as its child element with asChild", () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go somewhere</a>
      </Button>
    )
    const link = screen.getByRole("link", { name: "Go somewhere" })
    expect(link).toHaveAttribute("href", "/somewhere")
    expect(link).toHaveAttribute("data-slot", "button")
  })

  it("merges a custom className", () => {
    render(<Button className="custom-class">C</Button>)
    expect(screen.getByRole("button")).toHaveClass("custom-class")
  })

  it("buttonVariants composes classes for a given variant", () => {
    expect(buttonVariants({ variant: "outline" })).toContain("border")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<Button>Accessible</Button>)
    expect(await axe(container)).toHaveNoViolations()
  })
})
