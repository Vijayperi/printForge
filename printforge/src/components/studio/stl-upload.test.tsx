import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { StlUpload } from "@/src/components/studio/stl-upload"

const fetchMock = vi.fn()

function stlFile() {
  return new File([new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64])], "cube.stl", { type: "model/stl" })
}

function fileInput() {
  return screen.getByLabelText("Upload your own STL") as HTMLInputElement
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("StlUpload", () => {
  it("renders the file input, button, and helper note", () => {
    render(<StlUpload projectId="proj_1" onUploaded={() => {}} />)
    expect(fileInput()).toHaveAttribute("accept", ".stl")
    expect(screen.getByRole("button", { name: "Upload STL" })).toBeInTheDocument()
    expect(screen.getByText(/same printability checks/)).toBeInTheDocument()
  })

  it("requires a file before uploading", async () => {
    const user = userEvent.setup()
    const onUploaded = vi.fn()
    render(<StlUpload projectId="proj_1" onUploaded={onUploaded} />)
    await user.click(screen.getByRole("button", { name: "Upload STL" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose an .stl file/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it("shows an uploading state, calls onUploaded, and clears the input on success", async () => {
    const user = userEvent.setup()
    const onUploaded = vi.fn()
    let resolveFetch: (value: { ok: boolean }) => void = () => {}
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)))

    render(<StlUpload projectId="proj_1" onUploaded={onUploaded} />)
    await user.upload(fileInput(), stlFile())
    expect(fileInput().files).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "Upload STL" }))

    expect(await screen.findByRole("button", { name: "Uploading…" })).toBeDisabled()
    // The upload posts to the STL endpoint with the file + projectId.
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }]
    expect(url).toBe("/api/uploads/stl")
    expect(init.body.get("projectId")).toBe("proj_1")
    expect(init.body.get("file")).toBeInstanceOf(File)

    resolveFetch({ ok: true })
    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(fileInput().value).toBe("")
  })

  it("shows the server error message on failure", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "invalid STL (truncated)" } }) })
    render(<StlUpload projectId="proj_1" onUploaded={() => {}} />)
    await user.upload(fileInput(), stlFile())
    await user.click(screen.getByRole("button", { name: "Upload STL" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("invalid STL (truncated)"))
  })

  it("falls back to a generic message when the error body is not JSON", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("no json")
      },
    })
    render(<StlUpload projectId="proj_1" onUploaded={() => {}} />)
    await user.upload(fileInput(), stlFile())
    await user.click(screen.getByRole("button", { name: "Upload STL" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Upload failed/))
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<StlUpload projectId="proj_1" onUploaded={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
