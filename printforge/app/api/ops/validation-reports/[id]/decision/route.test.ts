import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/validation-reports/[id]/decision/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "vr_1" }) }

function seed(status = "manual_review") {
  return createFakeDb({
    validation_reports: {
      rows: [
        {
          id: "vr_1",
          design_version_id: "dv_1",
          printer_profile_id: "generic-fdm",
          status,
          findings_json: [],
          created_at: "1",
        },
      ],
      unique: ["id"],
    },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown): Request {
  return new Request("http://test/api/ops/validation-reports/vr_1/decision", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

const report = () => db.rows("validation_reports")[0]!

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/decision", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post({ action: "approve", reason: "fine" }), ctx)).status).toBe(404)
    expect(report().status).toBe("manual_review")
  })

  it("overrides a manual review to pass and audits the reason", async () => {
    const response = await POST(post({ action: "approve", reason: "walls are fine" }), ctx)
    expect(await response.json()).toEqual({ status: "pass" })
    expect(report().status).toBe("pass")
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      entity_type: "validation_report",
      action: "validation.operator_approve",
      metadata: { reason: "walls are fine", from: "manual_review", to: "pass" },
    })
  })

  it("overrides a manual review to fail", async () => {
    const response = await POST(post({ action: "reject", reason: "too thin" }), ctx)
    expect(await response.json()).toEqual({ status: "fail" })
    expect(report().status).toBe("fail")
  })

  it("409s a report that is not in manual review", async () => {
    db = seed("pass")
    const response = await POST(post({ action: "approve", reason: "again" }), ctx)
    expect(response.status).toBe(409)
    expect(report().status).toBe("pass")
  })

  it("400s a non-json body", async () => {
    const request = new Request("http://test/api/ops/validation-reports/vr_1/decision", {
      method: "POST",
      body: "{",
    })
    expect((await POST(request, ctx)).status).toBe(400)
  })

  it.each([
    ["a missing reason", { action: "approve" }],
    ["a blank reason", { action: "approve", reason: " " }],
    ["an unknown action", { action: "defer", reason: "later" }],
  ])("400s %s", async (_label, body) => {
    expect((await POST(post(body), ctx)).status).toBe(400)
  })

  it("404s a report that does not exist", async () => {
    db = createFakeDb({
      validation_reports: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(404)
  })

  it("502s when the report lookup fails", async () => {
    db.failNext({ message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("502s when the status update fails", async () => {
    db.failCall(2, { message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("502s when the audit row cannot be written", async () => {
    db.failCall(3, { message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })
})
