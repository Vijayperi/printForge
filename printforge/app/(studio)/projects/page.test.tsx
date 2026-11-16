import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => ({ getUser })),
}))

vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => ({}) as never),
}))

const listProjectsByUser = vi.fn()
vi.mock("@/src/data/projects", () => ({
  listProjectsByUser: (...a: unknown[]) => listProjectsByUser(...a),
}))

// The page imports server actions; stub them so importing the module is inert.
vi.mock("@/app/(studio)/projects/actions", () => ({
  createProjectAction: vi.fn(),
  renameProjectAction: vi.fn(),
  archiveProjectAction: vi.fn(),
}))

import ProjectsPage from "@/app/(studio)/projects/page"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

function projectRow(id: string, title: string, status = "active") {
  return { id, user_id: "u1", title, status, created_at: "1", updated_at: "1" }
}

afterEach(() => vi.clearAllMocks())

describe("ProjectsPage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(ProjectsPage()).rejects.toThrow("redirect:/login")
  })

  it("redirects to login when the gateway errors", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    await expect(ProjectsPage()).rejects.toThrow("redirect:/login")
  })

  it("renders the empty state when there are no projects", async () => {
    getUser.mockResolvedValue(ok(USER))
    listProjectsByUser.mockResolvedValue(ok([]))
    render(await ProjectsPage())
    expect(screen.getByText("No projects yet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument()
  })

  it("renders the empty state when the repository errors", async () => {
    getUser.mockResolvedValue(ok(USER))
    listProjectsByUser.mockResolvedValue(err(appError("provider_error", "db down")))
    render(await ProjectsPage())
    expect(screen.getByText("No projects yet")).toBeInTheDocument()
  })

  it("renders a card per project", async () => {
    getUser.mockResolvedValue(ok(USER))
    listProjectsByUser.mockResolvedValue(
      ok([projectRow("proj_1", "Desk tidy"), projectRow("proj_2", "Planter", "archived")])
    )
    render(await ProjectsPage())
    expect(screen.getByText("Desk tidy")).toBeInTheDocument()
    expect(screen.getByText("Planter")).toBeInTheDocument()
    expect(screen.getAllByTestId("project-card")).toHaveLength(2)
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument()
  })
})
