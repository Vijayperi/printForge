import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/dynamic", () => ({
  default: () => function LazyStub() {
    return <div data-testid="lazy-viewer" />
  },
}))

import { DemoLoadingFallback, DemoSlot, loadViewerWorkspace } from "@/src/components/landing/demo-slot"

class FakeObserver {
  static instances: FakeObserver[] = []
  constructor(public cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    FakeObserver.instances.push(this)
  }
  observe = vi.fn()
  disconnect = vi.fn()
  trigger(isIntersecting: boolean) {
    this.cb([{ isIntersecting }])
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeObserver.instances = []
})

describe("DemoSlot", () => {
  it("shows the poster placeholder before it is in view", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver)
    render(<DemoSlot />)
    expect(screen.getByText(/Interactive 3D preview/)).toBeInTheDocument()
    expect(screen.queryByTestId("lazy-viewer")).not.toBeInTheDocument()
    expect(FakeObserver.instances[0]?.observe).toHaveBeenCalled()
  })

  it("loads the viewer once it intersects", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver)
    render(<DemoSlot />)
    const observer = FakeObserver.instances[0]!
    // A non-intersecting entry keeps the placeholder.
    act(() => observer.trigger(false))
    expect(screen.queryByTestId("lazy-viewer")).not.toBeInTheDocument()
    // Intersecting swaps in the lazy viewer.
    act(() => observer.trigger(true))
    expect(screen.getByTestId("lazy-viewer")).toBeInTheDocument()
  })

  it("degrades gracefully when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined)
    render(<DemoSlot />)
    expect(screen.getByText(/Interactive 3D preview/)).toBeInTheDocument()
  })

  it("disconnects the observer when the node detaches", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver)
    const { unmount } = render(<DemoSlot />)
    const observer = FakeObserver.instances[0]!
    unmount()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it("renders a loading fallback while the viewer chunk loads", () => {
    render(<DemoLoadingFallback />)
    expect(screen.getByText("Loading 3D preview…")).toBeInTheDocument()
  })

  it("lazily resolves the ViewerWorkspace component", async () => {
    const Component = await loadViewerWorkspace()
    expect(typeof Component).toBe("function")
  })
})
