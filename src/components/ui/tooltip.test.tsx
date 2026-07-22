import { render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip"

// Radix Tooltip measures its trigger via ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function renderTooltip(open = true, contentClassName?: string) {
  return render(
    <TooltipProvider>
      <Tooltip open={open}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent className={contentClassName}>Helpful hint</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe("Tooltip", () => {
  it("renders the trigger", () => {
    renderTooltip(false)
    expect(screen.getByText("Hover me")).toHaveAttribute("data-slot", "tooltip-trigger")
  })

  it("renders the content when open", () => {
    renderTooltip(true)
    // Radix renders the tooltip content (possibly duplicated for a11y); at least one is present.
    expect(screen.getAllByText("Helpful hint").length).toBeGreaterThan(0)
  })

  it("merges a custom className on the content", () => {
    renderTooltip(true, "content-x")
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveClass("content-x")
  })

  it("renders the trigger and content together under the provider", () => {
    renderTooltip(true)
    // TooltipProvider has no DOM node; its presence is proven by trigger + content rendering.
    expect(screen.getByText("Hover me")).toHaveAttribute("data-slot", "tooltip-trigger")
    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull()
  })

  it("has no accessibility violations", async () => {
    const { container } = renderTooltip(true)
    expect(await axe(container)).toHaveNoViolations()
  })
})
