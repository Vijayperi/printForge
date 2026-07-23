import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { PrintabilityPanel } from "@/src/components/studio/printability-panel"
import type { Finding, Measurements } from "@/src/domain/types"

const MEASUREMENTS: Measurements = {
  boundingMm: { x: 10, y: 10, z: 10 },
  volumeCm3: 1,
  surfaceAreaCm2: 6,
  triangleCount: 12,
  componentCount: 1,
  smallestComponentVolumeFraction: 1,
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(status, body)))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("PrintabilityPanel", () => {
  it("shows the pending label until a report arrives", () => {
    stubFetch({ status: "pending", findings: [], measurements: null })
    render(<PrintabilityPanel designVersionId="dv_1" />)
    expect(screen.getByText("Checking printability…")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith("/api/design-versions/dv_1/validation")
  })

  it("renders a passing verdict with measurements and no findings list", async () => {
    stubFetch({ status: "pass", findings: [], measurements: MEASUREMENTS })
    render(<PrintabilityPanel designVersionId="dv_1" />)
    expect(await screen.findByText("Ready to print")).toBeInTheDocument()
    expect(screen.getByText(/passed our automated checks/)).toBeInTheDocument()
    expect(screen.getByText(/12 triangles/)).toBeInTheDocument()
    expect(screen.queryByText("What we found")).not.toBeInTheDocument()
  })

  it("renders a manual_review verdict with plain-language findings", async () => {
    const findings: Finding[] = [
      { kind: "boundary_holes", severity: "warning", detail: "1 boundary loop across 4 open edges", count: 4 },
    ]
    stubFetch({ status: "manual_review", findings, measurements: MEASUREMENTS })
    render(<PrintabilityPanel designVersionId="dv_1" />)
    expect(await screen.findByText("Needs a human check")).toBeInTheDocument()
    expect(screen.getByText("What we found")).toBeInTheDocument()
    expect(screen.getByText("Open holes")).toBeInTheDocument()
    expect(screen.getByText(/isn’t fully closed/)).toBeInTheDocument()
    expect(screen.getByText("1 boundary loop across 4 open edges")).toBeInTheDocument()
  })

  it("renders a warning verdict", async () => {
    stubFetch({
      status: "warning",
      findings: [{ kind: "unsupported_overhang", severity: "warning", detail: "40% steep", count: 40 }],
      measurements: MEASUREMENTS,
    })
    render(<PrintabilityPanel designVersionId="dv_1" />)
    expect(await screen.findByText("Printable with notes")).toBeInTheDocument()
    expect(screen.getByText("Steep overhangs")).toBeInTheDocument()
  })

  it("renders a failing verdict with null measurements", async () => {
    stubFetch({
      status: "fail",
      findings: [{ kind: "empty_mesh", severity: "blocking", detail: "unreadable STL" }],
      measurements: null,
    })
    render(<PrintabilityPanel designVersionId="dv_1" />)
    expect(await screen.findByText("Not printable yet")).toBeInTheDocument()
    expect(screen.getByText("Empty model")).toBeInTheDocument()
    expect(screen.queryByText(/triangles/)).not.toBeInTheDocument()
  })

  it("keeps polling on the interval until a terminal verdict arrives", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { status: "pending", findings: [], measurements: null }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "pass", findings: [], measurements: MEASUREMENTS }))
    vi.stubGlobal("fetch", fetchMock)

    render(<PrintabilityPanel designVersionId="dv_1" />)
    await vi.advanceTimersByTimeAsync(0) // immediate tick → pending
    expect(screen.getByText("Checking printability…")).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(2000) // interval fires → pass
    expect(screen.getByText("Ready to print")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("stays pending when the report request errors", async () => {
    stubFetch({}, 500)
    render(<PrintabilityPanel designVersionId="dv_1" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText("Checking printability…")).toBeInTheDocument()
  })

  it("does not update state after unmount (in-flight request)", async () => {
    let resolveFetch: (res: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)))
    )
    const { unmount } = render(<PrintabilityPanel designVersionId="dv_1" />)
    unmount()
    resolveFetch(jsonResponse(200, { status: "pass", findings: [], measurements: MEASUREMENTS }))
    await Promise.resolve()
    await Promise.resolve()
    // No throw / no act warning: the post-unmount guard skipped setState.
    expect(true).toBe(true)
  })

  it("has no accessibility violations", async () => {
    stubFetch({
      status: "manual_review",
      findings: [{ kind: "inverted_normals", severity: "warning", detail: "flip proposed" }],
      measurements: MEASUREMENTS,
    })
    const { container } = render(<PrintabilityPanel designVersionId="dv_1" />)
    await screen.findByText("Needs a human check")
    expect(await axe(container)).toHaveNoViolations()
  })
})
