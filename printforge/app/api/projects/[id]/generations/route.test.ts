import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok, err } from "@/src/lib/result"
import { appError } from "@/src/lib/errors"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

const check = vi.fn()
vi.mock("@/src/adapters/moderation/factory", () => ({ getModerator: vi.fn(() => ({ check })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

import { POST } from "@/app/api/projects/[id]/generations/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const validBody = {
  rawPrompt: "a friendly dinosaur",
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "cute",
  durability: "display",
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/projects/proj_1/generations", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

const ctx = { params: Promise.resolve({ id: "proj_1" }) }

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  check.mockResolvedValue(ok({ verdict: "allow" }))
  db = createFakeDb({
    projects: { rows: [{ id: "proj_1", user_id: "u1", title: "T", status: "active" }] },
  })
  db.onRpc("bump_rate_limit", () => ({ data: [{ allowed: true, retry_after: 0 }], error: null }))
  db.onRpc("enqueue_generation", () => ({ data: [{ design_version_id: "dv_1", job_id: "job_1" }], error: null }))
})

afterEach(() => vi.clearAllMocks())

describe("POST generations", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(post(validBody), ctx)).status).toBe(401)
  })

  it("400 on invalid JSON", async () => {
    expect((await POST(post(null, "not json"), ctx)).status).toBe(400)
  })

  it("400 on schema violation", async () => {
    const res = await POST(post({ ...validBody, rawPrompt: "" }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe("validation")
  })

  it("404 when the project is not owned", async () => {
    db = createFakeDb({ projects: { rows: [] } })
    expect((await POST(post(validBody), ctx)).status).toBe(404)
  })

  it("502 when the ownership lookup errors", async () => {
    db.failNext({ message: "db down" })
    expect((await POST(post(validBody), ctx)).status).toBe(502)
  })

  it("400 when moderation denies the prompt", async () => {
    check.mockResolvedValue(ok({ verdict: "deny", category: "weapons" }))
    const res = await POST(post(validBody), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/content policy/)
  })

  it("502 when moderation itself fails", async () => {
    check.mockResolvedValue(err(appError("provider_error", "moderator down")))
    expect((await POST(post(validBody), ctx)).status).toBe(502)
  })

  it("429 with Retry-After when rate limited", async () => {
    db.onRpc("bump_rate_limit", () => ({ data: [{ allowed: false, retry_after: 1800 }], error: null }))
    const res = await POST(post(validBody), ctx)
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("1800")
  })

  it("502 when the rate limiter errors", async () => {
    db.onRpc("bump_rate_limit", () => ({ data: null, error: { message: "rl down" } }))
    expect((await POST(post(validBody), ctx)).status).toBe(502)
  })

  it("202 with the design version id on success", async () => {
    const res = await POST(post(validBody), ctx)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ designVersionId: "dv_1" })
  })

  it("202 and marks the brief flagged when moderation flags the prompt", async () => {
    check.mockResolvedValue(ok({ verdict: "flag", category: "knife" }))
    let captured: Record<string, unknown> = {}
    db.onRpc("enqueue_generation", (args) => {
      captured = args
      return { data: [{ design_version_id: "dv_1", job_id: "job_1" }], error: null }
    })
    const res = await POST(post(validBody), ctx)
    expect(res.status).toBe(202)
    expect((captured["p_brief"] as Record<string, unknown>)["flagged"]).toBe(true)
  })

  it("502 when the enqueue rpc errors", async () => {
    db.onRpc("enqueue_generation", () => ({ data: null, error: { message: "enqueue boom" } }))
    expect((await POST(post(validBody), ctx)).status).toBe(502)
  })

  it("500 when the enqueue rpc returns no row", async () => {
    db.onRpc("enqueue_generation", () => ({ data: null, error: null }))
    expect((await POST(post(validBody), ctx)).status).toBe(500)
  })
})

describe("FakeDb import guard", () => {
  it("constructs", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
