import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

vi.mock("@/src/components/studio/creator-workspace", () => ({
  CreatorWorkspace: (props: { project: { title: string }; versions: unknown[] }) => (
    <div data-testid="workspace" data-project={props.project.title} data-count={props.versions.length} />
  ),
}))

import ProjectDetailPage from "@/app/(studio)/projects/[projectId]/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ projectId: "proj_1" }) }

afterEach(() => vi.clearAllMocks())

describe("ProjectDetailPage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    db = createFakeDb()
    await expect(ProjectDetailPage(ctx)).rejects.toThrow("redirect:/login")
  })

  it("404s when the project is not owned", async () => {
    getUser.mockResolvedValue(ok(USER))
    db = createFakeDb({ projects: { rows: [] } })
    await expect(ProjectDetailPage(ctx)).rejects.toThrow("not-found")
  })

  it("renders the workspace with the project and its versions", async () => {
    getUser.mockResolvedValue(ok(USER))
    db = createFakeDb({
      projects: { rows: [{ id: "proj_1", user_id: "u1", title: "Desk Tidy", status: "active" }] },
      design_versions: {
        rows: [
          { id: "dv_1", project_id: "proj_1", version_no: 1, generation_status: "ready" },
          { id: "dv_2", project_id: "proj_1", version_no: 2, generation_status: "creating" },
        ],
      },
    })
    render(await ProjectDetailPage(ctx))
    const workspace = screen.getByTestId("workspace")
    expect(workspace).toHaveAttribute("data-project", "Desk Tidy")
    expect(workspace).toHaveAttribute("data-count", "2")
  })

  it("renders with no versions when the version query fails", async () => {
    getUser.mockResolvedValue(ok(USER))
    db = createFakeDb({
      projects: { rows: [{ id: "proj_1", user_id: "u1", title: "Desk Tidy", status: "active" }] },
    })
    db.failCall(2, { message: "versions boom" }) // op1 project lookup, op2 versions list
    render(await ProjectDetailPage(ctx))
    expect(screen.getByTestId("workspace")).toHaveAttribute("data-count", "0")
  })
})
