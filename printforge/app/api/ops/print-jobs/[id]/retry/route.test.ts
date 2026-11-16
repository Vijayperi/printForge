import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/print-jobs/[id]/retry/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "pj_1" }) }

const FAILED = {
  id: "pj_1",
  order_id: "ord_1",
  status: "failed",
  printer_id: "prn_1",
  failure_reason: "nozzle jam",
  attempt: 1,
  created_at: "1",
}

function seed(job: Record<string, unknown> = FAILED) {
  return createFakeDb({
    print_jobs: { rows: [job], unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/print-jobs/pj_1/retry", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

const VALID = { reason: "cleared the jam" }

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/retry", () => {
  it("404s a customer without retrying", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("print_jobs")[0]?.status).toBe("failed")
  })

  it("requeues the job, counts the attempt and clears the stale failure", async () => {
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      printJobId: "pj_1",
      status: "pending",
      attempt: 2,
    })
    expect(db.rows("print_jobs")[0]).toMatchObject({
      status: "pending",
      attempt: 2,
      failure_reason: null,
      printer_id: "prn_1",
    })
    expect(db.rows("audit_events")[0]).toMatchObject({
      action: "print_job.retry",
      entity_id: "pj_1",
      metadata: {
        reason: "cleared the jam",
        orderId: "ord_1",
        attempt: 2,
        previousFailure: "nozzle jam",
      },
    })
  })

  it("412s once the attempt cap is spent, leaving the job failed", async () => {
    db = seed({ ...FAILED, attempt: 3 })
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(412)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: expect.stringMatching(/escalate/) },
    })
    expect(db.rows("print_jobs")[0]?.status).toBe("failed")
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it.each(["pending", "released", "printing", "completed", "cancelled"])(
    "409s a %s job",
    async (status) => {
      db = seed({ ...FAILED, status })
      expect((await POST(post(VALID), ctx)).status).toBe(409)
    }
  )

  it("404s an unknown print job", async () => {
    db = createFakeDb({
      print_jobs: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post(VALID), ctx)).status).toBe(404)
  })

  it.each([
    ["a non-json body", undefined, "{"],
    ["a blank reason", { reason: " " }, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("print_jobs")[0]?.status).toBe("failed")
  })
})

describe("POST …/retry — persistence failures", () => {
  it.each([
    ["the job lookup", 1],
    ["the status update", 2],
    ["the audit write", 3],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post(VALID), ctx)).status).toBe(502)
  })
})
