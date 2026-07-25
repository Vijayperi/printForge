import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/print-jobs/[id]/cancel/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "pj_1" }) }

const JOB = {
  id: "pj_1",
  order_id: "ord_1",
  status: "pending",
  printer_id: "prn_1",
  failure_reason: null,
  attempt: 1,
  created_at: "1",
}

function seed(job: Record<string, unknown> = JOB) {
  return createFakeDb({
    print_jobs: { rows: [job], unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/print-jobs/pj_1/cancel", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

const VALID = { reason: "customer changed the colour" }

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/cancel", () => {
  it("404s a customer without cancelling", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("print_jobs")[0]?.status).toBe("pending")
  })

  it.each(["pending", "released", "printing"])("cancels a %s job", async (status) => {
    db = seed({ ...JOB, status })
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ printJobId: "pj_1", status: "cancelled" })
    expect(db.rows("print_jobs")[0]).toMatchObject({
      status: "cancelled",
      failure_reason: "customer changed the colour",
    })
    expect(db.rows("audit_events")[0]).toMatchObject({
      action: "print_job.cancel",
      entity_id: "pj_1",
      metadata: { reason: "customer changed the colour", orderId: "ord_1", from: status },
    })
  })

  it.each(["completed", "failed", "cancelled"])("409s a %s job", async (status) => {
    db = seed({ ...JOB, status })
    expect((await POST(post(VALID), ctx)).status).toBe(409)
    expect(db.rows("print_jobs")[0]?.status).toBe(status)
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it("404s an unknown print job", async () => {
    db = createFakeDb({
      print_jobs: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post(VALID), ctx)).status).toBe(404)
  })

  it.each([
    ["a non-json body", undefined, "{"],
    ["a missing reason", {}, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("print_jobs")[0]?.status).toBe("pending")
  })
})

describe("POST …/cancel — persistence failures", () => {
  it.each([
    ["the job lookup", 1],
    ["the status update", 2],
    ["the audit write", 3],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post(VALID), ctx)).status).toBe(502)
  })
})
