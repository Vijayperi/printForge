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

import { GET, POST } from "@/app/api/design-versions/[id]/quote/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ id: "dv_1" }) }
const req = new Request("http://test/api/design-versions/dv_1/quote", { method: "POST" })
const getReq = new Request("http://test/api/design-versions/dv_1/quote")

const CONFIG_HASH = "1|pla|standard|everyday|standard"

function configRow(over: Record<string, unknown> = {}) {
  return {
    id: "cfg_1",
    design_version_id: "dv_1",
    material_id: "pla",
    color_id: "pla-white",
    dimensions_mm: { x: 10, y: 10, z: 10 },
    scale_factor: 1,
    quality_id: "standard",
    strength_id: "everyday",
    shipping_speed: "standard",
    special_instructions: "",
    created_at: "2026-01-01",
    ...over,
  }
}

function seed(opts: { configRows?: Record<string, unknown>[]; reportRows?: Record<string, unknown>[]; quoteRows?: Record<string, unknown>[]; dvRows?: Record<string, unknown>[] } = {}) {
  return createFakeDb({
    design_versions: { rows: opts.dvRows ?? [{ id: "dv_1", project_id: "proj_1", generation_status: "ready" }] },
    print_configurations: { rows: opts.configRows ?? [configRow()], unique: ["id"] },
    validation_reports: { rows: opts.reportRows ?? [{ id: "vr_1", design_version_id: "dv_1", status: "pass", created_at: "2026-01-02" }], unique: ["id"] },
    quotes: { rows: opts.quoteRows ?? [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

const freshQuote = (over: Record<string, unknown> = {}) => ({
  id: "qt_1",
  configuration_id: "cfg_1",
  config_hash: CONFIG_HASH,
  status: "active",
  amount_minor: 24360,
  currency: "INR",
  breakdown_json: [{ key: "material", label: "Material", amount: { amountMinor: 6000, currency: "INR" } }],
  slice_json: { materialGrams: 20, durationMinutes: 60, supportsUsed: false },
  expires_at: "2099-01-01T00:00:00.000Z",
  created_at: "2026-01-03",
  ...over,
})

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST quote", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(req, ctx)).status).toBe(401)
  })

  it("404 when the design version is not visible", async () => {
    db = seed({ dvRows: [] })
    expect((await POST(req, ctx)).status).toBe(404)
  })

  it("412 when there is no configuration", async () => {
    db = seed({ configRows: [] })
    expect((await POST(req, ctx)).status).toBe(412)
  })

  it("412 when there is no validation report", async () => {
    db = seed({ reportRows: [] })
    expect((await POST(req, ctx)).status).toBe(412)
  })

  it("412 when the verdict is not printable", async () => {
    db = seed({ reportRows: [{ id: "vr_1", design_version_id: "dv_1", status: "fail", created_at: "1" }] })
    expect((await POST(req, ctx)).status).toBe(412)
  })

  it("200 ready when a fresh active quote already exists", async () => {
    db = seed({ quoteRows: [freshQuote()] })
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ready")
    expect(body.quote.id).toBe("qt_1")
    expect(body.quote.amountMinor).toBe(24360)
    expect(db.rows("jobs")).toHaveLength(0)
  })

  it("202 pending_slice and enqueues slicing.run when no fresh quote exists", async () => {
    const res = await POST(req, ctx)
    expect(res.status).toBe(202)
    expect((await res.json()).status).toBe("pending_slice")
    const jobs = db.rows("jobs")
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!["type"]).toBe("slicing.run")
    expect(jobs[0]!["payload"]).toMatchObject({ designVersionId: "dv_1", configHash: CONFIG_HASH })
    expect(jobs[0]!["idempotency_key"]).toContain(`slice:dv_1:${CONFIG_HASH}`)
  })

  it("expires a lapsed quote on read and re-requests a slice", async () => {
    db = seed({ quoteRows: [freshQuote({ expires_at: "2000-01-01T00:00:00.000Z" })] })
    const res = await POST(req, ctx)
    expect(res.status).toBe(202)
    expect(db.rows("quotes")[0]!["status"]).toBe("expired")
    expect(db.rows("jobs")).toHaveLength(1)
  })

  it("502 propagations", async () => {
    db = seed()
    db.failNext({ message: "dv boom" })
    expect((await POST(req, ctx)).status).toBe(502)

    db = seed()
    db.failCall(2, { message: "config boom" })
    expect((await POST(req, ctx)).status).toBe(502)

    db = seed()
    db.failCall(3, { message: "report boom" })
    expect((await POST(req, ctx)).status).toBe(502)

    db = seed()
    db.failCall(4, { message: "quote boom" })
    expect((await POST(req, ctx)).status).toBe(502)

    db = seed({ quoteRows: [freshQuote({ expires_at: "2000-01-01T00:00:00.000Z" })] })
    db.failCall(5, { message: "expire boom" }) // op5 = updateQuoteStatus
    expect((await POST(req, ctx)).status).toBe(502)

    db = seed()
    db.failCall(5, { message: "enqueue boom" }) // op5 = enqueue insert (no quote path)
    expect((await POST(req, ctx)).status).toBe(502)
  })
})

describe("GET quote", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(getReq, ctx)).status).toBe(401)
  })

  it("412 when there is no configuration", async () => {
    db = seed({ configRows: [] })
    expect((await GET(getReq, ctx)).status).toBe(412)
  })

  it("200 none when no quote exists yet", async () => {
    const res = await GET(getReq, ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "none" })
  })

  it("200 none when the only quote is superseded", async () => {
    db = seed({ quoteRows: [freshQuote({ status: "superseded" })] })
    expect((await GET(getReq, ctx)).json().then((b) => b.status)).resolves.toBe("none")
  })

  it("200 ready with the fresh quote", async () => {
    db = seed({ quoteRows: [freshQuote()] })
    const res = await GET(getReq, ctx)
    const body = await res.json()
    expect(body.status).toBe("ready")
    expect(body.quote.breakdown[0].key).toBe("material")
  })

  it("expires a lapsed quote and reports none", async () => {
    db = seed({ quoteRows: [freshQuote({ expires_at: "2000-01-01T00:00:00.000Z" })] })
    const res = await GET(getReq, ctx)
    expect((await res.json()).status).toBe("none")
    expect(db.rows("quotes")[0]!["status"]).toBe("expired")
  })

  it("502 when the quote lookup errors", async () => {
    db.failCall(3, { message: "quote boom" }) // op1 dv, op2 config, op3 quote lookup
    expect((await GET(getReq, ctx)).status).toBe(502)
  })
})
