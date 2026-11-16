import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import type { ProjectFormState } from "@/app/(studio)/projects/actions"
import { ProjectCard } from "@/src/components/projects/project-card"
import type { ProjectRow } from "@/src/domain/types"

const idle = async (): Promise<ProjectFormState> => ({})

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "proj_1",
    user_id: "u1",
    title: "Desk tidy",
    status: "active",
    created_at: "1",
    updated_at: "1",
    ...overrides,
  }
}

describe("ProjectCard", () => {
  it("renders the title linking to the project, and an active status badge", () => {
    render(<ProjectCard project={project()} renameAction={idle} archiveAction={idle} />)
    expect(screen.getByRole("link", { name: "Desk tidy" })).toHaveAttribute("href", "/projects/proj_1")
    expect(screen.getByText("active")).toBeInTheDocument()
  })

  it("renders an outline badge and a disabled archive button for archived projects", () => {
    render(
      <ProjectCard project={project({ status: "archived" })} renameAction={idle} archiveAction={idle} />
    )
    expect(screen.getByText("archived")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled()
  })

  it("opens the rename dialog, prefilled, and closes on done", async () => {
    const user = userEvent.setup()
    const renameAction = vi.fn(async (): Promise<ProjectFormState> => ({ done: true }))
    render(<ProjectCard project={project()} renameAction={renameAction} archiveAction={idle} />)
    await user.click(screen.getByRole("button", { name: "Rename" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByLabelText("Project name")).toHaveValue("Desk tidy")
    await user.click(within(dialog).getByRole("button", { name: "Save" }))
    expect(renameAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("shows a rename field error", async () => {
    const user = userEvent.setup()
    const renameAction = vi.fn(
      async (): Promise<ProjectFormState> => ({ fieldErrors: { title: ["project name is too long"] } })
    )
    render(<ProjectCard project={project()} renameAction={renameAction} archiveAction={idle} />)
    await user.click(screen.getByRole("button", { name: "Rename" }))
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByText("project name is too long")).toBeInTheDocument())
    expect(within(screen.getByRole("dialog")).getByLabelText("Project name")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("confirms archiving through the alert dialog", async () => {
    const user = userEvent.setup()
    const archiveAction = vi.fn(async (): Promise<ProjectFormState> => ({ done: true }))
    render(<ProjectCard project={project()} renameAction={idle} archiveAction={archiveAction} />)
    await user.click(screen.getByRole("button", { name: "Archive" }))
    const alert = screen.getByRole("alertdialog")
    expect(within(alert).getByText("Archive this project?")).toBeInTheDocument()
    await user.click(within(alert).getByRole("button", { name: "Archive" }))
    expect(archiveAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("surfaces an archive error and keeps the alert open", async () => {
    const user = userEvent.setup()
    const archiveAction = vi.fn(async (): Promise<ProjectFormState> => ({ formError: "no match" }))
    render(<ProjectCard project={project()} renameAction={idle} archiveAction={archiveAction} />)
    await user.click(screen.getByRole("button", { name: "Archive" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }))
    await waitFor(() => expect(screen.getByText("no match")).toBeInTheDocument())
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("can cancel the archive alert", async () => {
    const user = userEvent.setup()
    render(<ProjectCard project={project()} renameAction={idle} archiveAction={idle} />)
    await user.click(screen.getByRole("button", { name: "Archive" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ProjectCard project={project()} renameAction={idle} archiveAction={idle} />
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
