import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/orders/[id]/print-jobs/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "ord_1" }) }

const ORDER = {
  id: "ord_1",
  user_id: "u1",
  status: "production_queued",
  payment_status: "paid",
  created_at: "1",
}

function seed(order: Record<string, unknown> = ORDER, jobs: Record<string, unknown>[] = []) {
  return createFakeDb({
    orders: { rows: [order], unique: ["id"] },
    print_jobs: { rows: jobs, unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/orders/ord_1/print-jobs", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/print-jobs", () => {
  it("404s a customer without creating anything", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post({ reason: "go" }), ctx)).status).toBe(404)
    expect(db.rows("print_jobs")).toHaveLength(0)
  })

  it("queues the first print and audits it", async () => {
    const response = await POST(post({ reason: "bed is free" }), ctx)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ status: "pending", attempt: 1 })

    const job = db.rows("print_jobs")[0]
    expect(job).toMatchObject({ order_id: "ord_1", status: "pending", printer_id: null, attempt: 1 })
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      actor_kind: "user",
      entity_type: "print_job",
      entity_id: job?.id,
      action: "print_job.created",
      metadata: { reason: "bed is free", orderId: "ord_1", attempt: 1 },
    })
  })

  it("counts a reprint as the order's next attempt", async () => {
    db = seed(ORDER, [
      { id: "pj_1", order_id: "ord_1", status: "completed", attempt: 1, created_at: "1" },
    ])
    const response = await POST(post({ reason: "qc rejected the first one" }), ctx)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ attempt: 2 })
  })

  it("404s an unknown order", async () => {
    db = createFakeDb({
      orders: { rows: [], unique: ["id"] },
      print_jobs: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post({ reason: "go" }), ctx)).status).toBe(404)
  })

  it.each([
    ["an unpaid order", { ...ORDER, payment_status: "unpaid" }, []],
    ["an order still in review", { ...ORDER, status: "design_review" }, []],
    [
      "an order that already has an active job",
      ORDER,
      [{ id: "pj_1", order_id: "ord_1", status: "printing", attempt: 1, created_at: "1" }],
    ],
    [
      "an order that has spent every attempt",
      ORDER,
      [{ id: "pj_1", order_id: "ord_1", status: "failed", attempt: 3, created_at: "1" }],
    ],
  ])("412s %s", async (_name, order, jobs) => {
    db = seed(order, jobs as Record<string, unknown>[])
    const before = db.rows("print_jobs").length
    expect((await POST(post({ reason: "go" }), ctx)).status).toBe(412)
    expect(db.rows("print_jobs")).toHaveLength(before)
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it.each([
    ["a non-json body", undefined, "{"],
    ["a blank reason", { reason: "  " }, undefined],
    ["an extra key", { reason: "go", printerId: "prn_1" }, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("print_jobs")).toHaveLength(0)
  })
})

describe("POST …/print-jobs — persistence failures", () => {
  it.each([
    ["the order lookup", 1],
    ["the existing-jobs lookup", 2],
    ["the insert", 3],
    ["the audit write", 4],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post({ reason: "go" }), ctx)).status).toBe(502)
  })
})
