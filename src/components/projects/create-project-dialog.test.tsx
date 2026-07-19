import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import type { ProjectFormState } from "@/app/(studio)/projects/actions"
import { CreateProjectDialog } from "@/src/components/projects/create-project-dialog"

const idle = async (): Promise<ProjectFormState> => ({})

describe("CreateProjectDialog", () => {
  it("opens the dialog from the trigger and shows the form", async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog action={idle} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "New project" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Create a project")).toBeInTheDocument()
    expect(screen.getByLabelText("Project name")).toBeInTheDocument()
  })

  it("closes the dialog when the action reports done", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<ProjectFormState> => ({ done: true }))
    render(<CreateProjectDialog action={action} />)
    await user.click(screen.getByRole("button", { name: "New project" }))
    await user.type(screen.getByLabelText("Project name"), "Desk tidy")
    await user.click(screen.getByRole("button", { name: "Create" }))
    expect(action).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("shows a field error and marks the input invalid", async () => {
    const user = userEvent.setup()
    const action = vi.fn(
      async (): Promise<ProjectFormState> => ({ fieldErrors: { title: ["enter a project name"] } })
    )
    render(<CreateProjectDialog action={action} />)
    await user.click(screen.getByRole("button", { name: "New project" }))
    await user.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(screen.getByText("enter a project name")).toBeInTheDocument())
    expect(screen.getByLabelText("Project name")).toHaveAttribute("aria-invalid", "true")
  })

  it("shows a form-level error", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<ProjectFormState> => ({ formError: "You must be signed in." }))
    render(<CreateProjectDialog action={action} />)
    await user.click(screen.getByRole("button", { name: "New project" }))
    await user.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(screen.getByText("You must be signed in.")).toBeInTheDocument())
    expect(screen.getByRole("dialog")).toBeInTheDocument() // stays open on error
  })

  it("has no accessibility violations when open", async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog action={idle} />)
    await user.click(screen.getByRole("button", { name: "New project" }))
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations()
  })
})
