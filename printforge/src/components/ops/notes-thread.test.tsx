import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import { NotesThread, type OrderNote } from "@/src/components/ops/notes-thread"

const NOTES: OrderNote[] = [
  {
    id: "evt_1",
    note: "Customer asked for matte finish",
    author: "op@x.com",
    createdAt: "2026-02-01T10:30:00.000Z",
  },
]

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "evt_2" }), { status: 201 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("NotesThread", () => {
  it("says so when the thread is empty", () => {
    render(<NotesThread orderId="ord_1" notes={[]} />)
    expect(screen.getByText("No notes yet.")).toBeInTheDocument()
  })

  it("shows each note with its author and UTC timestamp", () => {
    render(<NotesThread orderId="ord_1" notes={NOTES} />)
    expect(screen.getByText("Customer asked for matte finish")).toBeInTheDocument()
    expect(screen.getByText(/op@x.com · 2026-02-01 10:30 UTC/)).toBeInTheDocument()
  })

  it("offers no way to edit or delete an existing note", () => {
    render(<NotesThread orderId="ord_1" notes={NOTES} />)
    expect(screen.queryByRole("button", { name: /edit|delete/i })).not.toBeInTheDocument()
  })

  it("keeps the submit disabled until something is typed", async () => {
    const user = userEvent.setup()
    render(<NotesThread orderId="ord_1" notes={[]} />)
    const submit = screen.getByRole("button", { name: "Add note" })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText("Add a note"), "chased the customer")
    expect(submit).toBeEnabled()
  })

  it("posts the note, clears the box and refreshes", async () => {
    const user = userEvent.setup()
    render(<NotesThread orderId="ord_1" notes={[]} />)
    await user.type(screen.getByLabelText("Add a note"), "chased the customer")
    await user.click(screen.getByRole("button", { name: "Add note" }))

    expect(fetchMock).toHaveBeenCalledWith("/api/ops/orders/ord_1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "chased the customer" }),
    })
    expect(screen.getByLabelText("Add a note")).toHaveValue("")
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the draft when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }))
    const user = userEvent.setup()
    render(<NotesThread orderId="ord_1" notes={[]} />)
    await user.type(screen.getByLabelText("Add a note"), "important context")
    await user.click(screen.getByRole("button", { name: "Add note" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved")
    expect(screen.getByLabelText("Add a note")).toHaveValue("important context")
    expect(refresh).not.toHaveBeenCalled()
  })
})
