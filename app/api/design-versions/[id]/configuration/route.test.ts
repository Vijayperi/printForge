import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => db),
  getServiceDb: vi.fn(() => db),
}))

import { GET, POST } from "@/app/api/design-versions/[id]/configuration/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ id: "dv_1" }) }

function validBody(over: Record<string, unknown> = {}) {
  return {
    materialId: "pla",
    colorId: "pla-white",
    dimensionsMm: { x: 50, y: 50, z: 50 },
    scaleFactor: 1,
    qualityId: "standard",
    strengthId: "everyday",
    shippingSpeed: "standard",
    specialInstructions: "",
    ...over,
  }
}

function post(body: unknown): Request {
  return new Request("http://test/api/design-versions/dv_1/configuration", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function seed(configRows: Record<string, unknown>[] = []) {
  return createFakeDb({
    design_versions: { rows: [{ id: "dv_1", project_id: "proj_1", generation_status: "ready" }] },
    print_configurations: { rows: configRows, unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST configuration — guards", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(post(validBody()), ctx)).status).toBe(401)
  })

  it("400 on a non-JSON body", async () => {
    expect((await POST(post("not json"), ctx)).status).toBe(400)
  })

  it("400 on a malformed body shape", async () => {
    expect((await POST(post({ materialId: "pla" }), ctx)).status).toBe(400)
  })

  it("400 with per-field violations for an out-of-stock colour", async () => {
    const res = await POST(post(validBody({ colorId: "pla-slate" })), ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.violations.map((v: { code: string }) => v.code)).toContain("color_out_of_stock")
    expect(body.violations[0].field).toBe("color")
  })

  it("404 when the design version is not visible", async () => {
    db = createFakeDb({
      design_versions: { rows: [] },
      print_configurations: { rows: [], unique: ["id"] },
      jobs: { rows: [], unique: ["id", "idempotency_key"] },
    })
    expect((await POST(post(validBody()), ctx)).status).toBe(404)
  })

  it("502 when the design-version read errors", async () => {
    db.failNext({ message: "db down" })
    expect((await POST(post(validBody()), ctx)).status).toBe(502)
  })

  it("502 when the prior-config read errors", async () => {
    db.failCall(2, { message: "config down" }) // op1 dv select, op2 prior config select
    expect((await POST(post(validBody()), ctx)).status).toBe(502)
  })

  it("502 when the upsert errors", async () => {
    // op1 dv, op2 prior config, op3 upsert's own lookup, op4 insert
    db.failCall(4, { message: "insert down" })
    expect((await POST(post(validBody()), ctx)).status).toBe(502)
  })
})

describe("POST configuration — persistence & re-validation", () => {
  it("persists a first config at scale 1 without re-validating (base report already covers it)", async () => {
    const res = await POST(post(validBody()), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revalidating).toBe(false)
    expect(body.configuration.material_id).toBe("pla")
    expect(db.rows("print_configurations")).toHaveLength(1)
    expect(db.rows("jobs")).toHaveLength(0)
  })

  it("re-enqueues validation.run when the scale changes, with scale + profile + material threaded", async () => {
    const res = await POST(post(validBody({ scaleFactor: 2, materialId: "petg", colorId: "petg-clear" })), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revalidating).toBe(true)
    expect(body.scaleHash).toBe("s2")

    const jobs = db.rows("jobs")
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!["type"]).toBe("validation.run")
    expect(jobs[0]!["idempotency_key"]).toBe("validate:dv_1:s2")
    const payload = jobs[0]!["payload"] as Record<string, unknown>
    expect(payload).toMatchObject({
      designVersionId: "dv_1",
      scaleFactor: 2,
      scaleHash: "s2",
      printerProfileId: "generic-fdm",
      materialId: "petg",
    })
  })

  it("does NOT re-validate when only the colour changes at the same scale", async () => {
    db = seed([
      { id: "cfg_1", design_version_id: "dv_1", scale_factor: 2, color_id: "pla-white", created_at: "2026-01-01" },
    ])
    const res = await POST(post(validBody({ scaleFactor: 2, colorId: "pla-black" })), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).revalidating).toBe(false)
    expect(db.rows("jobs")).toHaveLength(0)
    expect(db.rows("print_configurations")).toHaveLength(1)
  })

  it("502 when the re-validation enqueue errors", async () => {
    // op1 dv, op2 prior config, op3 upsert lookup, op4 insert, op5 job insert
    db.failCall(5, { message: "enqueue down" })
    expect((await POST(post(validBody({ scaleFactor: 3 })), ctx)).status).toBe(502)
  })
})

describe("GET configuration", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(new Request("http://test"), ctx)).status).toBe(401)
  })

  it("404 when the design version is not visible", async () => {
    db = createFakeDb({
      design_versions: { rows: [] },
      print_configurations: { rows: [], unique: ["id"] },
      jobs: { rows: [], unique: ["id"] },
    })
    expect((await GET(new Request("http://test"), ctx)).status).toBe(404)
  })

  it("502 when the design-version read errors", async () => {
    db.failNext({ message: "db down" })
    expect((await GET(new Request("http://test"), ctx)).status).toBe(502)
  })

  it("502 when the config read errors", async () => {
    db.failCall(2, { message: "config down" })
    expect((await GET(new Request("http://test"), ctx)).status).toBe(502)
  })

  it("200 with null when no configuration exists yet", async () => {
    const res = await GET(new Request("http://test"), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configuration: null })
  })

  it("200 with the saved configuration", async () => {
    db = seed([{ id: "cfg_1", design_version_id: "dv_1", material_id: "petg", created_at: "2026-01-01" }])
    const res = await GET(new Request("http://test"), ctx)
    const body = await res.json()
    expect(body.configuration.id).toBe("cfg_1")
    expect(body.configuration.material_id).toBe("petg")
  })
})
