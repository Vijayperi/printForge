import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/print-jobs/[id]/qc/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "pj_1" }) }

const JOB = {
  id: "pj_1",
  order_id: "ord_1",
  status: "completed",
  printer_id: "prn_1",
  attempt: 2,
  created_at: "1",
}
const ORDER = {
  id: "ord_1",
  user_id: "u1",
  status: "quality_check",
  payment_status: "paid",
  created_at: "1",
}

function seed(job: Record<string, unknown> = JOB, order: Record<string, unknown> = ORDER) {
  return createFakeDb({
    print_jobs: { rows: [job], unique: ["id"] },
    orders: { rows: [order], unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/print-jobs/pj_1/qc", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/qc", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post({ outcome: "pass", reason: "looks good" }), ctx)).status).toBe(404)
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it("a pass asks for a shipment and leaves the order in quality check", async () => {
    const response = await POST(post({ outcome: "pass", reason: "dimensions within spec" }), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      printJobId: "pj_1",
      orderStatus: "quality_check",
      awaitingShipment: true,
    })
    expect(db.rows("orders")[0]?.status).toBe("quality_check")
    expect(db.rows("audit_events")[0]).toMatchObject({
      action: "print_job.qc.pass",
      entity_id: "pj_1",
      metadata: { orderId: "ord_1", attempt: 2, from: "quality_check", to: "quality_check" },
    })
  })

  it("a fail returns the order to the production queue for a reprint", async () => {
    const response = await POST(post({ outcome: "fail", reason: "layer shift at 40mm" }), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      printJobId: "pj_1",
      orderStatus: "production_queued",
      awaitingShipment: false,
    })
    expect(db.rows("orders")[0]?.status).toBe("production_queued")
    expect(db.rows("audit_events")[0]).toMatchObject({
      action: "print_job.qc.fail",
      metadata: { reason: "layer shift at 40mm", from: "quality_check", to: "production_queued" },
    })
  })

  it.each(["pending", "released", "printing", "failed", "cancelled"])(
    "412s a %s job — there is nothing to inspect yet",
    async (status) => {
      db = seed({ ...JOB, status })
      expect((await POST(post({ outcome: "pass", reason: "ok" }), ctx)).status).toBe(412)
      expect(db.rows("audit_events")).toHaveLength(0)
    }
  )

  it.each(["production_queued", "printing", "shipped"])(
    "409s when the order is %s rather than in quality check",
    async (status) => {
      db = seed(JOB, { ...ORDER, status })
      expect((await POST(post({ outcome: "fail", reason: "ok" }), ctx)).status).toBe(409)
      expect(db.rows("orders")[0]?.status).toBe(status)
    }
  )

  it("404s an unknown print job", async () => {
    db = createFakeDb({
      print_jobs: { rows: [], unique: ["id"] },
      orders: { rows: [ORDER], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post({ outcome: "pass", reason: "ok" }), ctx)).status).toBe(404)
  })

  it("404s when the job's order has vanished", async () => {
    db = createFakeDb({
      print_jobs: { rows: [JOB], unique: ["id"] },
      orders: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post({ outcome: "pass", reason: "ok" }), ctx)).status).toBe(404)
  })

  it.each([
    ["a non-json body", undefined, "{"],
    ["an unknown outcome", { outcome: "maybe", reason: "ok" }, undefined],
    ["a missing reason", { outcome: "pass" }, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("audit_events")).toHaveLength(0)
  })
})

describe("POST …/qc — persistence failures", () => {
  it.each([
    ["the job lookup", 1],
    ["the order lookup", 2],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post({ outcome: "pass", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("502s when the order update fails on a qc failure", async () => {
    db.failCall(3, { message: "boom" })
    expect((await POST(post({ outcome: "fail", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("502s when the audit write fails", async () => {
    db.failCall(3, { message: "boom" })
    expect((await POST(post({ outcome: "pass", reason: "ok" }), ctx)).status).toBe(502)
  })
})
