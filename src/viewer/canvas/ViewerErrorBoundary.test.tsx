import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ViewerErrorBoundary } from "@/src/viewer/canvas/ViewerErrorBoundary"

function Boom(): never {
  throw new Error("load failed")
}

describe("ViewerErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught errors to console.error; silence for a clean run.
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it("renders children when there is no error", () => {
    render(
      <ViewerErrorBoundary onError={() => {}}>
        <p>the model</p>
      </ViewerErrorBoundary>
    )
    expect(screen.getByText("the model")).toBeInTheDocument()
  })

  it("catches an error, notifies the host, and renders nothing", () => {
    const onError = vi.fn()
    const { container } = render(
      <ViewerErrorBoundary onError={onError}>
        <Boom />
      </ViewerErrorBoundary>
    )
    expect(onError).toHaveBeenCalledOnce()
    expect(container).toBeEmptyDOMElement()
  })
})
