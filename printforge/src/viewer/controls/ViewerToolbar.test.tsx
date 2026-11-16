import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { ViewerToolbar, type ViewerToolbarProps } from "@/src/viewer/controls/ViewerToolbar"

function setup(over: Partial<ViewerToolbarProps> = {}) {
  const props: ViewerToolbarProps = {
    mode: "visual",
    showNormals: false,
    showBoundingBox: false,
    fullscreen: false,
    onSetMode: vi.fn(),
    onToggleNormals: vi.fn(),
    onToggleBbox: vi.fn(),
    onReset: vi.fn(),
    onFit: vi.fn(),
    onFullscreen: vi.fn(),
    onScreenshot: vi.fn(),
    ...over,
  }
  return { props, ...render(<ViewerToolbar {...props} />) }
}

describe("ViewerToolbar", () => {
  it("renders a toolbar reflecting the current mode", () => {
    setup({ mode: "mesh" })
    expect(screen.getByRole("toolbar", { name: "3D viewer controls" })).toHaveAttribute(
      "data-viewer-mode",
      "mesh"
    )
    expect(screen.getByRole("button", { name: "Visual" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Technical Mesh" })).toHaveAttribute("aria-pressed", "true")
  })

  it("switches mode via the toggle buttons", async () => {
    const user = userEvent.setup()
    const { props } = setup({ mode: "visual" })
    await user.click(screen.getByRole("button", { name: "Technical Mesh" }))
    expect(props.onSetMode).toHaveBeenCalledWith("mesh")
    await user.click(screen.getByRole("button", { name: "Visual" }))
    expect(props.onSetMode).toHaveBeenCalledWith("visual")
  })

  it("toggles normals and bounding box", async () => {
    const user = userEvent.setup()
    const { props } = setup()
    await user.click(screen.getByRole("switch", { name: "Show normals" }))
    expect(props.onToggleNormals).toHaveBeenCalledOnce()
    await user.click(screen.getByRole("switch", { name: "Bounding box" }))
    expect(props.onToggleBbox).toHaveBeenCalledOnce()
  })

  it("reflects switch checked state from props", () => {
    setup({ showNormals: true, showBoundingBox: true })
    expect(screen.getByRole("switch", { name: "Show normals" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Bounding box" })).toBeChecked()
  })

  it("fires the action buttons on click", async () => {
    const user = userEvent.setup()
    const { props } = setup()
    await user.click(screen.getByRole("button", { name: "Reset view" }))
    await user.click(screen.getByRole("button", { name: "Fit to view" }))
    await user.click(screen.getByRole("button", { name: "Fullscreen" }))
    await user.click(screen.getByRole("button", { name: "Screenshot" }))
    expect(props.onReset).toHaveBeenCalledOnce()
    expect(props.onFit).toHaveBeenCalledOnce()
    expect(props.onFullscreen).toHaveBeenCalledOnce()
    expect(props.onScreenshot).toHaveBeenCalledOnce()
  })

  it("activates a button via the keyboard", async () => {
    const user = userEvent.setup()
    const { props } = setup()
    screen.getByRole("button", { name: "Reset view" }).focus()
    await user.keyboard("{Enter}")
    expect(props.onReset).toHaveBeenCalledOnce()
  })

  it("marks the fullscreen button pressed state", () => {
    setup({ fullscreen: true })
    expect(screen.getByRole("button", { name: "Fullscreen" })).toHaveAttribute("aria-pressed", "true")
  })

  it("has no accessibility violations", async () => {
    const { container } = setup()
    expect(await axe(container)).toHaveNoViolations()
  })
})
