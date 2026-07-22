import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreationPanel } from "@/src/components/studio/creation-panel"
import { sampleBrief } from "@/tests/helpers/designVersion"

function jsonResponse(status: number, body: unknown, opts: { badJson?: boolean } = {}): Response {
  return {
    ok: status < 400,
    status,
    json: async () => {
      if (opts.badJson) throw new Error("no json")
      return body
    },
  } as unknown as Response
}

function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Create a model" }))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("CreationPanel", () => {
  it("renders the form, cost notice, and Generate label when fresh", () => {
    render(<CreationPanel projectId="proj_1" initialBrief={null} onGenerated={() => {}} />)
    expect(screen.getByLabelText("What would you like to create?")).toHaveValue("")
    expect(screen.getByText(/may use credits/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument()
  })

  it("prefills from an initial brief and shows Regenerate", () => {
    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    expect(screen.getByLabelText("What would you like to create?")).toHaveValue("a friendly dinosaur")
    expect(screen.getByLabelText("Intended use")).toHaveValue("gift")
    expect(screen.getByLabelText("Durability")).toHaveValue("display")
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
  })

  it("submits, polls to ready, and notifies the parent", async () => {
    vi.useFakeTimers()
    const onGenerated = vi.fn()
    const statuses = ["creating", "ready"]
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/projects")) return Promise.resolve(jsonResponse(202, { designVersionId: "dv_9" }))
      return Promise.resolve(jsonResponse(200, { status: statuses.shift() }))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={onGenerated} />)
    await act(async () => submit())
    expect(screen.getByText("Queued")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText("Generating…")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText("Ready")).toBeInTheDocument()
    expect(onGenerated).toHaveBeenCalledOnce()

    // Polling stopped: further ticks do not fetch again.
    const callsAfterReady = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterReady)
  })

  it("shows the failed state when generation fails", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((url: string) =>
      url.startsWith("/api/projects")
        ? Promise.resolve(jsonResponse(202, { designVersionId: "dv_9" }))
        : Promise.resolve(jsonResponse(200, { status: "failed" }))
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    await act(async () => submit())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText(/adjust and try again/)).toBeInTheDocument()
  })

  it("keeps polling when a status check errors transiently", async () => {
    vi.useFakeTimers()
    const responses = [jsonResponse(500, null), jsonResponse(200, { status: "ready" })]
    const fetchMock = vi.fn((url: string) =>
      url.startsWith("/api/projects")
        ? Promise.resolve(jsonResponse(202, { designVersionId: "dv_9" }))
        : Promise.resolve(responses.shift() as Response)
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    await act(async () => submit())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // transient 500 — ignored
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // ready
    })
    expect(screen.getByText("Ready")).toBeInTheDocument()
  })

  it("shows a rate-limit message on 429", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(429, {})))
    vi.stubGlobal("fetch", fetchMock)
    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    await act(async () => submit())
    await waitFor(() => expect(screen.getByText(/reached the generation limit/)).toBeInTheDocument())
  })

  it("shows the server's message on a policy/validation error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(400, { error: { message: "This request violates our content policy." } }))
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    await act(async () => submit())
    await waitFor(() => expect(screen.getByText(/content policy/)).toBeInTheDocument())
  })

  it("falls back to a generic message when the error body is unreadable", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(400, null, { badJson: true })))
    vi.stubGlobal("fetch", fetchMock)
    render(<CreationPanel projectId="proj_1" initialBrief={sampleBrief} onGenerated={() => {}} />)
    await act(async () => submit())
    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })
})
