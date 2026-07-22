import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

const h = vi.hoisted(() => ({
  capture: vi.fn(),
  onLoadError: null as null | (() => void),
  onResetHandled: null as null | (() => void),
}))

// The Canvas host is the WebGL boundary; mock it to drive the callbacks a real
// canvas would (report a loaded model, hand up a capture fn, and expose the
// error/reset callbacks so tests can drive them).
vi.mock("@/src/viewer/canvas/ModelViewer", async () => {
  const React = await import("react")
  return {
    ModelViewer: (props: {
      mode: string
      resetRequested: boolean
      onLoaded: (b: unknown, t: number) => void
      onLoadError: () => void
      onResetHandled: () => void
      onCaptureReady: (fn: (filename: string) => void) => void
    }) => {
      h.onLoadError = props.onLoadError
      h.onResetHandled = props.onResetHandled
      React.useEffect(() => {
        props.onCaptureReady(h.capture)
        props.onLoaded({ min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 3 } }, 12)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return React.createElement("div", {
        "data-testid": "model-viewer-stub",
        "data-mode": props.mode,
        "data-reset": String(props.resetRequested),
      })
    },
  }
})

import { ViewerWorkspace } from "@/src/viewer/ViewerWorkspace"

function renderWorkspace() {
  return render(<ViewerWorkspace url="/samples/cube.glb" projectTitle="Desk Tidy" />)
}

afterEach(() => vi.clearAllMocks())

describe("ViewerWorkspace", () => {
  it("starts in visual mode and shows the texture disclaimer", () => {
    renderWorkspace()
    expect(screen.getByTestId("model-viewer-stub")).toBeInTheDocument()
    const root = screen.getByRole("toolbar").parentElement as HTMLElement
    expect(root).toHaveAttribute("data-viewer-mode", "visual")
    expect(screen.getByText(/FDM print/i)).toBeInTheDocument()
  })

  it("switches to mesh mode and hides the disclaimer", async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await user.click(screen.getByRole("button", { name: "Technical Mesh" }))
    const root = screen.getByRole("toolbar").parentElement as HTMLElement
    expect(root).toHaveAttribute("data-viewer-mode", "mesh")
    expect(screen.queryByText(/FDM print/i)).not.toBeInTheDocument()
  })

  it("shows dimensions once the model reports it loaded", async () => {
    renderWorkspace()
    await waitFor(() => expect(screen.getByText("2.0 mm")).toBeInTheDocument())
    expect(screen.getByText("4.0 mm")).toBeInTheDocument()
    expect(screen.getByText("6.0 mm")).toBeInTheDocument()
  })

  it("toggles the normals and bounding-box switches", async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const normals = screen.getByRole("switch", { name: "Show normals" })
    expect(normals).toHaveAttribute("aria-checked", "false")
    await user.click(normals)
    expect(normals).toHaveAttribute("aria-checked", "true")

    const bbox = screen.getByRole("switch", { name: "Bounding box" })
    await user.click(bbox)
    expect(bbox).toHaveAttribute("aria-checked", "true")
  })

  it("captures a screenshot with a generated filename", async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await user.click(screen.getByRole("button", { name: "Screenshot" }))
    expect(h.capture).toHaveBeenCalledOnce()
    expect(h.capture.mock.calls[0]?.[0]).toMatch(/^printforge-desk-tidy-.*\.png$/)
  })

  it("handles reset, fit, and fullscreen without error", async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await user.click(screen.getByRole("button", { name: "Reset view" }))
    await user.click(screen.getByRole("button", { name: "Fit to view" }))
    await user.click(screen.getByRole("button", { name: "Fullscreen" }))
    expect(screen.getByTestId("model-viewer-stub")).toBeInTheDocument()
  })

  it("announces a load error reported by the viewer", async () => {
    renderWorkspace()
    act(() => h.onLoadError?.())
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/failed to load/i))
  })

  it("clears the reset request once the viewer handles it", async () => {
    const user = userEvent.setup()
    renderWorkspace()
    await user.click(screen.getByRole("button", { name: "Reset view" }))
    expect(screen.getByTestId("model-viewer-stub")).toHaveAttribute("data-reset", "true")
    act(() => h.onResetHandled?.())
    expect(screen.getByTestId("model-viewer-stub")).toHaveAttribute("data-reset", "false")
  })

  it("has no accessibility violations", async () => {
    const { container } = renderWorkspace()
    expect(await axe(container)).toHaveNoViolations()
  })
})
