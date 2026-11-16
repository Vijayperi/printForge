import { afterEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => ({ getUser })),
}))

const getRequestDb = vi.fn(async () => ({}) as never)
vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: () => getRequestDb(),
}))

const createProject = vi.fn()
const listProjectsByUser = vi.fn()
vi.mock("@/src/data/projects", () => ({
  createProject: (...a: unknown[]) => createProject(...a),
  listProjectsByUser: (...a: unknown[]) => listProjectsByUser(...a),
}))

import { GET, POST } from "@/app/api/projects/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

function postRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  })
}

afterEach(() => vi.clearAllMocks())

describe("POST /api/projects", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue(ok(null))
    const res = await POST(postRequest({ title: "X" }))
    expect(res.status).toBe(401)
    expect(createProject).not.toHaveBeenCalled()
  })

  it("401 when the gateway errors", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    const res = await POST(postRequest({ title: "X" }))
    expect(res.status).toBe(401)
  })

  it("400 on invalid JSON", async () => {
    getUser.mockResolvedValue(ok(USER))
    const res = await POST(postRequest(undefined, "{not json"))
    expect(res.status).toBe(400)
  })

  it("400 on schema violation", async () => {
    getUser.mockResolvedValue(ok(USER))
    const res = await POST(postRequest({ title: "   " }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("validation")
  })

  it("201 with the created project", async () => {
    getUser.mockResolvedValue(ok(USER))
    createProject.mockResolvedValue(
      ok({ id: "proj_1", user_id: "u1", title: "Desk tidy", status: "active" })
    )
    const res = await POST(postRequest({ title: "Desk tidy" }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { project: { title: string } }
    expect(body.project.title).toBe("Desk tidy")
    expect(createProject).toHaveBeenCalledWith(expect.anything(), { userId: "u1", title: "Desk tidy" })
  })

  it("maps a repository error to its HTTP status", async () => {
    getUser.mockResolvedValue(ok(USER))
    createProject.mockResolvedValue(err(appError("conflict", "dup")))
    const res = await POST(postRequest({ title: "X" }))
    expect(res.status).toBe(409)
  })
})

describe("GET /api/projects", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue(ok(null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("200 with the user's projects", async () => {
    getUser.mockResolvedValue(ok(USER))
    listProjectsByUser.mockResolvedValue(ok([{ id: "proj_1", title: "A" }]))
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects: unknown[] }
    expect(body.projects).toHaveLength(1)
  })

  it("maps a repository error", async () => {
    getUser.mockResolvedValue(ok(USER))
    listProjectsByUser.mockResolvedValue(err(appError("provider_error", "db down")))
    const res = await GET()
    expect(res.status).toBe(502)
  })
})
