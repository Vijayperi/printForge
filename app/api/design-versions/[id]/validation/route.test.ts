import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

import { GET } from "@/app/api/design-versions/[id]/validation/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ id: "dv_1" }) }
const req = new Request("http://test/api/design-versions/dv_1/validation")

function seed(reportRows: Record<string, unknown>[] = []) {
  return createFakeDb({
    design_versions: { rows: [{ id: "dv_1", project_id: "proj_1", generation_status: "ready" }] },
    validation_reports: { rows: reportRows, unique: ["id"] },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("GET validation report", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(req, ctx)).status).toBe(401)
  })

  it("404 when the design version is not visible", async () => {
    db = createFakeDb({ design_versions: { rows: [] }, validation_reports: { rows: [] } })
    expect((await GET(req, ctx)).status).toBe(404)
  })

  it("502 when the design-version read errors", async () => {
    db.failNext({ message: "db down" })
    expect((await GET(req, ctx)).status).toBe(502)
  })

  it("502 when the report read errors", async () => {
    db.failCall(2, { message: "report down" }) // op1 = dv select, op2 = report select
    expect((await GET(req, ctx)).status).toBe(502)
  })

  it("200 pending when no report exists yet", async () => {
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "pending", findings: [], measurements: null, scaleHash: null })
  })

  it("200 with the latest report's verdict, findings, measurements and scaleHash", async () => {
    db = seed([
      { id: "vr_old", design_version_id: "dv_1", status: "pass", findings_json: [], measurements_json: null, scale_hash: "", created_at: "2026-01-01" },
      {
        id: "vr_new",
        design_version_id: "dv_1",
        status: "manual_review",
        findings_json: [{ kind: "boundary_holes", severity: "warning", detail: "x", count: 4 }],
        measurements_json: { volumeCm3: 1 },
        scale_hash: "s2",
        created_at: "2026-02-01",
      },
    ])
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("manual_review")
    expect(body.findings[0].kind).toBe("boundary_holes")
    expect(body.measurements.volumeCm3).toBe(1)
    expect(body.scaleHash).toBe("s2")
  })
})
