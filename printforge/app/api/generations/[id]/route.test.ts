import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

import { GET } from "@/app/api/generations/[id]/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ id: "dv_1" }) }
const req = new Request("http://test/api/generations/dv_1")

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = createFakeDb({
    design_versions: {
      rows: [
        {
          id: "dv_1",
          project_id: "proj_1",
          generation_status: "creating",
          provider_task_id: "task_secret",
        },
      ],
    },
  })
})

afterEach(() => vi.clearAllMocks())

describe("GET generation status", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(req, ctx)).status).toBe(401)
  })

  it("404 when the generation is not visible", async () => {
    db = createFakeDb({ design_versions: { rows: [] } })
    expect((await GET(req, ctx)).status).toBe(404)
  })

  it("502 when the read errors", async () => {
    db.failNext({ message: "db down" })
    expect((await GET(req, ctx)).status).toBe(502)
  })

  it("200 with normalized status and no provider fields", async () => {
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ designVersionId: "dv_1", status: "creating" })
    expect(body.provider_task_id).toBeUndefined()
  })
})

describe("FakeDb import guard", () => {
  it("constructs", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
