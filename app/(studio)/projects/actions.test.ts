import { afterEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => ({ getUser })),
}))

vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => ({}) as never),
}))

const createProject = vi.fn()
const renameProject = vi.fn()
const setProjectStatus = vi.fn()
vi.mock("@/src/data/projects", () => ({
  createProject: (...a: unknown[]) => createProject(...a),
  renameProject: (...a: unknown[]) => renameProject(...a),
  setProjectStatus: (...a: unknown[]) => setProjectStatus(...a),
}))

const revalidatePath = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}))

import {
  archiveProjectAction,
  createProjectAction,
  renameProjectAction,
} from "@/app/(studio)/projects/actions"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

afterEach(() => vi.clearAllMocks())

describe("createProjectAction", () => {
  it("returns field errors on an empty title", async () => {
    const state = await createProjectAction({}, form({ title: "  " }))
    expect(state.fieldErrors?.["title"]).toBeDefined()
    expect(createProject).not.toHaveBeenCalled()
  })

  it("blocks when signed out", async () => {
    getUser.mockResolvedValue(ok(null))
    const state = await createProjectAction({}, form({ title: "Thing" }))
    expect(state.formError).toMatch(/signed in/)
  })

  it("blocks when the gateway errors", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    const state = await createProjectAction({}, form({ title: "Thing" }))
    expect(state.formError).toMatch(/signed in/)
  })

  it("surfaces a repository failure", async () => {
    getUser.mockResolvedValue(ok(USER))
    createProject.mockResolvedValue(err(appError("provider_error", "insert failed")))
    const state = await createProjectAction({}, form({ title: "Thing" }))
    expect(state.formError).toMatch(/insert failed/)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("creates, revalidates, and reports done", async () => {
    getUser.mockResolvedValue(ok(USER))
    createProject.mockResolvedValue(ok({ id: "proj_1" }))
    const state = await createProjectAction({}, form({ title: "Thing" }))
    expect(state).toEqual({ done: true })
    expect(createProject).toHaveBeenCalledWith(expect.anything(), { userId: "u1", title: "Thing" })
    expect(revalidatePath).toHaveBeenCalledWith("/projects")
  })
})

describe("renameProjectAction", () => {
  it("returns field errors on invalid input", async () => {
    const state = await renameProjectAction({}, form({ id: "proj_1", title: "" }))
    expect(state.fieldErrors?.["title"]).toBeDefined()
  })

  it("blocks when signed out", async () => {
    getUser.mockResolvedValue(ok(null))
    const state = await renameProjectAction({}, form({ id: "proj_1", title: "New" }))
    expect(state.formError).toMatch(/signed in/)
  })

  it("surfaces a repository failure", async () => {
    getUser.mockResolvedValue(ok(USER))
    renameProject.mockResolvedValue(err(appError("not_found", "no match")))
    const state = await renameProjectAction({}, form({ id: "proj_1", title: "New" }))
    expect(state.formError).toMatch(/no match/)
  })

  it("renames and reports done", async () => {
    getUser.mockResolvedValue(ok(USER))
    renameProject.mockResolvedValue(ok({ id: "proj_1", title: "New" }))
    const state = await renameProjectAction({}, form({ id: "proj_1", title: "New" }))
    expect(state).toEqual({ done: true })
    expect(renameProject).toHaveBeenCalledWith(expect.anything(), "u1", "proj_1", "New")
  })
})

describe("archiveProjectAction", () => {
  it("returns field errors when the id is missing", async () => {
    const state = await archiveProjectAction({}, form({ id: "" }))
    expect(state.fieldErrors?.["id"]).toBeDefined()
  })

  it("blocks when signed out", async () => {
    getUser.mockResolvedValue(ok(null))
    const state = await archiveProjectAction({}, form({ id: "proj_1" }))
    expect(state.formError).toMatch(/signed in/)
  })

  it("surfaces a repository failure", async () => {
    getUser.mockResolvedValue(ok(USER))
    setProjectStatus.mockResolvedValue(err(appError("not_found", "no match")))
    const state = await archiveProjectAction({}, form({ id: "proj_1" }))
    expect(state.formError).toMatch(/no match/)
  })

  it("archives and reports done", async () => {
    getUser.mockResolvedValue(ok(USER))
    setProjectStatus.mockResolvedValue(ok({ id: "proj_1", status: "archived" }))
    const state = await archiveProjectAction({}, form({ id: "proj_1" }))
    expect(state).toEqual({ done: true })
    expect(setProjectStatus).toHaveBeenCalledWith(expect.anything(), "u1", "proj_1", "archived")
  })
})
