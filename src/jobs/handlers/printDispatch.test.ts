import { beforeEach, describe, expect, it, vi } from "vitest"

import { MockPrinterGateway, MOCK_SCRIPT_OFFLINE } from "@/src/adapters/printerGateway/mock"
import {
  cancelDispatchedJob,
  dispatchPrintJob,
  handlePrintDispatch,
  type PrintDispatchDeps,
} from "@/src/jobs/handlers/printDispatch"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { FixedClock } from "@/src/lib/clock"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-26T10:00:00Z")
const PRINTER = "prn_1"
const GCODE_KEY = "gcode/pj_1.gcode"

/** A lineage that satisfies all six release preconditions. */
function seed(
  over: {
    job?: Record<string, unknown>
    order?: Record<string, unknown>
    quote?: Record<string, unknown> | null
    report?: Record<string, unknown> | null
    asset?: Record<string, unknown> | null
  } = {}
): FakeDb {
  return createFakeDb({
    print_jobs: {
      rows: [
        {
          id: "pj_1",
          order_id: "ord_1",
          printer_id: PRINTER,
          status: "pending",
          gcode_asset_id: "ast_gcode",
          gateway_job_ref: null,
          failure_reason: "an earlier attempt jammed",
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
    quotes: {
      rows:
        over.quote === null
          ? []
          : [{ id: "qt_1", configuration_id: "cfg_1", status: "consumed", created_at: "1", ...over.quote }],
      unique: ["id"],
    },
    validation_reports: {
      rows:
        over.report === null
          ? []
          : [
              {
                id: "vr_1",
                design_version_id: "dv_1",
                printer_profile_id: "generic-fdm",
                status: "pass",
                created_at: "1",
                ...over.report,
              },
            ],
      unique: ["id"],
    },
    assets: {
      rows:
        over.asset === null
          ? []
          : [{ id: "ast_gcode", type: "gcode", storage_key: GCODE_KEY, created_at: "1", ...over.asset }],
      unique: ["id"],
    },
    printers: {
      rows: [
        { id: PRINTER, name: "Bay 1", gateway_kind: "mock", current_state: "idle", created_at: "1" },
      ],
      unique: ["id"],
    },
    audit_events: { rows: [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

let db: FakeDb
let gateway: MockPrinterGateway
let deps: PrintDispatchDeps

function makeDeps(over: { db?: FakeDb; gateway?: MockPrinterGateway } = {}): PrintDispatchDeps {
  const clock = new FixedClock(NOW)
  const database = over.db ?? db
  return {
    db: database,
    gateway: over.gateway ?? gateway,
    queue: new PostgresJobQueue(database, clock),
    clock,
  }
}

const RELEASE = { printJobId: "pj_1", actorId: "op1", reason: "bay 1 is loaded with white PLA" }

beforeEach(() => {
  db = seed()
  gateway = new MockPrinterGateway()
  deps = makeDeps()
})

describe("dispatchPrintJob", () => {
  it("sends the gcode to the machine, records the release and starts polling", async () => {
    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(true)

    const job = db.rows("print_jobs")[0]
    expect(job).toMatchObject({ status: "released", gateway_job_ref: "mock-gw-1" })
    // A stale failure reason from an earlier attempt must not follow the job.
    expect(job?.["failure_reason"]).toBeNull()

    expect(gateway.releasedJob("mock-gw-1")).toEqual({
      printJobId: "pj_1",
      gcodeStorageKey: GCODE_KEY,
    })

    expect(db.rows("printers")[0]).toMatchObject({
      current_state: "busy",
      last_seen_at: NOW.toISOString(),
    })

    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      actor_kind: "user",
      entity_type: "print_job",
      entity_id: "pj_1",
      action: "print_job.release",
      metadata: {
        orderId: "ord_1",
        printerId: PRINTER,
        attempt: 1,
        gatewayJobRef: "mock-gw-1",
        reason: RELEASE.reason,
      },
    })

    expect(db.rows("jobs")[0]).toMatchObject({
      type: "print.poll",
      idempotency_key: "print_poll:pj_1:1",
      payload: { printJobId: "pj_1", poll: 1 },
      // 30 s out, not immediately: the machine needs a moment to pick the file up.
      run_at: new Date(NOW.getTime() + 30_000).toISOString(),
    })
  })

  it("attributes a worker-initiated dispatch to the system", async () => {
    const result = await dispatchPrintJob(deps, {
      printJobId: "pj_1",
      actorId: null,
      reason: null,
    })
    expect(result.ok).toBe(true)
    expect(db.rows("audit_events")[0]).toMatchObject({ actor_id: null, actor_kind: "system" })
    expect(db.rows("audit_events")[0]?.["metadata"]).not.toHaveProperty("reason")
  })

  it("does nothing at all for a job already on a machine", async () => {
    db = seed({ job: { status: "released", gateway_job_ref: "mock-gw-99" } })
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(true)
    expect(db.rows("audit_events")).toHaveLength(0)
    expect(db.rows("jobs")).toHaveLength(0)
    expect(gateway.releasedJob("mock-gw-99")).toBeNull()
  })

  it("refuses a job the machine cannot legally leave", async () => {
    db = seed({ job: { status: "completed" } })
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("conflict")
  })

  const blocked = [
    ["an unpaid order", { order: { payment_status: "unpaid" } }, "this order has not been paid"],
    [
      "an order not yet approved",
      { order: { status: "design_review" } },
      "this order is not queued for production",
    ],
    [
      "a quote that was never consumed",
      { quote: { status: "active" } },
      "this order has no consumed quote",
    ],
    [
      "a design that only warned",
      { report: { status: "warning" } },
      "this design has not passed printability review",
    ],
    ["a job with no gcode", { job: { gcode_asset_id: null } }, "this job has no sliced gcode to send"],
    ["a job with no printer", { job: { printer_id: null } }, "this job has no printer assigned"],
  ] as const

  it.each(blocked)("refuses %s and never reaches the printer", async (_label, over, message) => {
    db = seed(over)
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("precondition_failed")
      expect(result.error.message).toBe(message)
    }
    expect(db.rows("print_jobs")[0]?.["status"]).toBe("pending")
    expect(db.rows("jobs")).toHaveLength(0)
  })

  it("surfaces a busy or offline machine as a precondition failure", async () => {
    gateway = new MockPrinterGateway({ [PRINTER]: MOCK_SCRIPT_OFFLINE })
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("precondition_failed")
      expect(result.error.message).toBe("the printer is offline")
    }
    expect(db.rows("print_jobs")[0]?.["status"]).toBe("pending")
  })

  const missing = [
    ["job", { print_jobs: [] }, "print job pj_1 not found"],
    ["order", { orders: [] }, "order ord_1 not found"],
  ] as const

  it.each(missing)("reports a missing %s", async (_label, empty, message) => {
    db = createFakeDb({
      print_jobs: {
        rows:
          "print_jobs" in empty
            ? []
            : [
                {
                  id: "pj_1",
                  order_id: "ord_1",
                  printer_id: PRINTER,
                  status: "pending",
                  gcode_asset_id: "ast_gcode",
                  gateway_job_ref: null,
                  attempt: 1,
                  created_at: "1",
                },
              ],
        unique: ["id"],
      },
      orders: { rows: [], unique: ["id"] },
    })
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.message).toBe(message)
    }
  })

  it("reports a gcode asset that has gone missing", async () => {
    db = seed({ asset: null })
    deps = makeDeps()

    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.message).toBe("gcode asset not found")
    }
  })

  const failures = [
    ["reading the print job", 1],
    ["reading the order", 2],
    ["reading the quote", 3],
    ["reading the validation report", 4],
    ["reading the gcode asset", 5],
    ["writing the job status", 6],
    ["writing the printer state", 7],
    ["writing the audit event", 8],
    ["enqueuing the first poll", 9],
  ] as const

  it.each(failures)("propagates a database failure while %s", async (_label, call) => {
    db.failCall(call, { message: "db down" })
    const result = await dispatchPrintJob(deps, RELEASE)
    expect(result.ok).toBe(false)
  })
})

describe("handlePrintDispatch", () => {
  it("rejects a payload that names no job", async () => {
    const result = await handlePrintDispatch(deps, { printJobId: "" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation")
      expect(result.error.message).toBe("invalid print.dispatch payload")
    }
  })

  it("dispatches with the operator and reason the payload carries", async () => {
    const result = await handlePrintDispatch(deps, {
      printJobId: "pj_1",
      actorId: "op7",
      reason: "manual re-dispatch after a network blip",
    })
    expect(result.ok).toBe(true)
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op7",
      metadata: { reason: "manual re-dispatch after a network blip" },
    })
  })

  it("dispatches as the system when the payload omits an actor", async () => {
    const result = await handlePrintDispatch(deps, { printJobId: "pj_1" })
    expect(result.ok).toBe(true)
    expect(db.rows("audit_events")[0]).toMatchObject({ actor_kind: "system" })
  })
})

describe("cancelDispatchedJob", () => {
  it("does not touch a printer for a job that never reached one", async () => {
    const cancel = vi.spyOn(gateway, "cancel")
    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: PRINTER,
      gateway_job_ref: null,
    })
    expect(result.ok).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
  })

  it("stops the machine and refreshes what it reports afterwards", async () => {
    await dispatchPrintJob(deps, RELEASE)

    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: PRINTER,
      gateway_job_ref: "mock-gw-1",
    })
    expect(result.ok).toBe(true)
    expect(gateway.wasCancelled("mock-gw-1")).toBe(true)
    expect(db.rows("printers")[0]).toMatchObject({ current_state: "idle" })
  })

  it("surfaces a machine that refuses to stop", async () => {
    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: PRINTER,
      gateway_job_ref: "mock-gw-unknown",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("not_found")
  })

  it("records a printer as offline when it cannot be asked what it is doing", async () => {
    await dispatchPrintJob(deps, RELEASE)
    vi.spyOn(gateway, "printerStatus").mockResolvedValue({
      ok: false,
      error: Object.assign(new Error("unreachable"), { code: "provider_error" as const }),
    })

    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: PRINTER,
      gateway_job_ref: "mock-gw-1",
    })
    expect(result.ok).toBe(true)
    expect(db.rows("printers")[0]).toMatchObject({ current_state: "offline" })
  })

  it("leaves the fleet alone for a job with no printer recorded", async () => {
    await dispatchPrintJob(deps, RELEASE)
    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: null,
      gateway_job_ref: "mock-gw-1",
    })
    expect(result.ok).toBe(true)
    expect(db.rows("printers")[0]).toMatchObject({ current_state: "busy" })
  })

  it("propagates a failure to write the refreshed printer state", async () => {
    await dispatchPrintJob(deps, RELEASE)
    db.failNext({ message: "db down" })

    const result = await cancelDispatchedJob(deps, {
      id: "pj_1",
      printer_id: PRINTER,
      gateway_job_ref: "mock-gw-1",
    })
    expect(result.ok).toBe(false)
  })
})
