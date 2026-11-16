import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/print-jobs/[id]/assign/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "pj_1" }) }

const JOB = {
  id: "pj_1",
  order_id: "ord_1",
  status: "pending",
  printer_id: null,
  attempt: 1,
  created_at: "1",
}
const PRINTER = { id: "prn_1", name: "Bay 1", gateway_kind: "mock", created_at: "1" }

function seed(job: Record<string, unknown> = JOB, printers = [PRINTER]) {
  return createFakeDb({
    print_jobs: { rows: [job], unique: ["id"] },
    printers: { rows: printers, unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/print-jobs/pj_1/assign", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

const VALID = { printerId: "prn_1", reason: "nearest free bed" }

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/assign", () => {
  it("404s a customer without assigning", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("print_jobs")[0]?.printer_id).toBeNull()
  })

  it("assigns the printer and audits the choice", async () => {
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ printJobId: "pj_1", printerId: "prn_1" })
    expect(db.rows("print_jobs")[0]?.printer_id).toBe("prn_1")
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      entity_type: "print_job",
      entity_id: "pj_1",
      action: "print_job.assigned",
      metadata: {
        reason: "nearest free bed",
        orderId: "ord_1",
        printerId: "prn_1",
        printerName: "Bay 1",
        previousPrinterId: null,
      },
    })
  })

  it("404s an unknown print job", async () => {
    db = createFakeDb({
      print_jobs: { rows: [], unique: ["id"] },
      printers: { rows: [PRINTER], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
    })
    expect((await POST(post(VALID), ctx)).status).toBe(404)
  })

  it("404s an unknown printer", async () => {
    db = seed(JOB, [])
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it.each(["released", "printing", "completed", "failed", "cancelled"])(
    "412s a %s job",
    async (status) => {
      db = seed({ ...JOB, status })
      expect((await POST(post(VALID), ctx)).status).toBe(412)
      expect(db.rows("audit_events")).toHaveLength(0)
    }
  )

  it.each([
    ["a non-json body", undefined, "{"],
    ["a missing printer", { printerId: " ", reason: "ok" }, undefined],
    ["a missing reason", { printerId: "prn_1" }, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("print_jobs")[0]?.printer_id).toBeNull()
  })
})

describe("POST …/assign — persistence failures", () => {
  it.each([
    ["the job lookup", 1],
    ["the printer lookup", 2],
    ["the assignment", 3],
    ["the audit write", 4],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post(VALID), ctx)).status).toBe(502)
  })
})
