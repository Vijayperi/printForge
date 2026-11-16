import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostgresJobQueue } from "@/src/jobs/queue"
import { FixedClock } from "@/src/lib/clock"
import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"
import {
  fakeGateway,
  MOCK_SCRIPT_OFFLINE,
  type MockPrinterGateway,
} from "@/tests/helpers/fakeGateway"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

let gateway: MockPrinterGateway
vi.mock("@/src/jobs/dispatchDeps", () => ({
  getDispatchDeps: () => ({
    db,
    gateway,
    queue: new PostgresJobQueue(db, new FixedClock(NOW)),
    clock: new FixedClock(NOW),
  }),
}))

import { POST } from "@/app/api/ops/print-jobs/[id]/release/route"

const NOW = new Date("2026-07-26T10:00:00Z")
const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "pj_1" }) }
const VALID = { reason: "bay 1 is loaded and free" }

function seed(over: { job?: Record<string, unknown>; order?: Record<string, unknown> } = {}): FakeDb {
  return createFakeDb({
    print_jobs: {
      rows: [
        {
          id: "pj_1",
          order_id: "ord_1",
          printer_id: "prn_1",
          status: "pending",
          gcode_asset_id: "ast_gcode",
          gateway_job_ref: null,
          attempt: 1,
          created_at: "1",
          ...over.job,
        },
      ],
      unique: ["id"],
    },
    orders: {
      rows: [
        {
          id: "ord_1",
          quote_id: "qt_1",
          frozen_dv_id: "dv_1",
          status: "production_queued",
          payment_status: "paid",
          created_at: "1",
          ...over.order,
        },
      ],
      unique: ["id"],
    },
    quotes: { rows: [{ id: "qt_1", status: "consumed", created_at: "1" }], unique: ["id"] },
    validation_reports: {
      rows: [{ id: "vr_1", design_version_id: "dv_1", status: "pass", created_at: "1" }],
      unique: ["id"],
    },
    assets: {
      rows: [{ id: "ast_gcode", storage_key: "gcode/pj_1.gcode", created_at: "1" }],
      unique: ["id"],
    },
    printers: {
      rows: [
        { id: "prn_1", name: "Bay 1", gateway_kind: "mock", current_state: "idle", created_at: "1" },
      ],
      unique: ["id"],
    },
    audit_events: { rows: [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/print-jobs/pj_1/release", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
  gateway = fakeGateway()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/release", () => {
  it("404s a customer without touching a printer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("print_jobs")[0]?.["status"]).toBe("pending")
    expect(gateway.releasedJob("mock-gw-1")).toBeNull()
  })

  it("requires a reason", async () => {
    const response = await POST(post({ reason: "  " }), ctx)
    expect(response.status).toBe(400)
    expect(db.rows("print_jobs")[0]?.["status"]).toBe("pending")
  })

  it("404s a print job that does not exist", async () => {
    db = createFakeDb({ print_jobs: { rows: [], unique: ["id"] } })
    expect((await POST(post(VALID), ctx)).status).toBe(404)
  })

  it("releases the job to its machine", async () => {
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ printJobId: "pj_1", status: "released" })

    expect(db.rows("print_jobs")[0]).toMatchObject({
      status: "released",
      gateway_job_ref: "mock-gw-1",
    })
    expect(gateway.releasedJob("mock-gw-1")).toEqual({
      printJobId: "pj_1",
      gcodeStorageKey: "gcode/pj_1.gcode",
    })
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      action: "print_job.release",
      metadata: { reason: VALID.reason },
    })
  })

  it("409s a second press instead of starting a second print", async () => {
    db = seed({ job: { status: "released", gateway_job_ref: "mock-gw-earlier" } })

    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "a released print job has already been released",
      },
    })
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it("412s with the guard's reason when a precondition is missing", async () => {
    db = seed({ job: { printer_id: null } })

    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(412)
    await expect(response.json()).resolves.toEqual({
      error: { code: "precondition_failed", message: "this job has no printer assigned" },
    })
  })

  it("412s with the machine's own reason when the printer cannot take it", async () => {
    gateway = fakeGateway({ prn_1: MOCK_SCRIPT_OFFLINE })

    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(412)
    await expect(response.json()).resolves.toEqual({
      error: { code: "precondition_failed", message: "the printer is offline" },
    })
    expect(db.rows("print_jobs")[0]?.["status"]).toBe("pending")
  })

  it("400s a malformed body", async () => {
    expect((await POST(post(null, "{oops"), ctx)).status).toBe(400)
  })

  it("propagates a database failure while reading the job", async () => {
    db.failCall(1, { message: "db down" })
    expect((await POST(post(VALID), ctx)).status).toBe(502)
  })
})
