import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  MockPrinterGateway,
  MOCK_SCRIPT_HAPPY,
  mockScriptFailsAt,
  type MockPrinterScript,
} from "@/src/adapters/printerGateway/mock"
import { PRINT_FAILURE_REASONS } from "@/src/domain/printDispatch"
import { dispatchPrintJob, type PrintDispatchDeps } from "@/src/jobs/handlers/printDispatch"
import { handlePrintPoll } from "@/src/jobs/handlers/printPoll"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { FixedClock } from "@/src/lib/clock"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-26T10:00:00Z")
const PRINTER = "prn_1"

function seed(over: { job?: Record<string, unknown>; order?: Record<string, unknown> } = {}): FakeDb {
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
          failure_reason: null,
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

function makeDeps(): PrintDispatchDeps {
  const clock = new FixedClock(NOW)
  return { db, gateway, queue: new PostgresJobQueue(db, clock), clock }
}

/** Put the seeded job on its machine, the way the release route does. */
async function release(): Promise<void> {
  const dispatched = await dispatchPrintJob(deps, {
    printJobId: "pj_1",
    actorId: "op1",
    reason: "bay 1 is free",
  })
  expect(dispatched.ok).toBe(true)
}

function job(): Record<string, unknown> {
  return db.rows("print_jobs")[0] as Record<string, unknown>
}

function order(): Record<string, unknown> {
  return db.rows("orders")[0] as Record<string, unknown>
}

function auditActions(): string[] {
  return db.rows("audit_events").map((row) => String(row["action"]))
}

function pollJobs(): Record<string, unknown>[] {
  return db.rows("jobs").filter((row) => row["type"] === "print.poll")
}

function notifications(template: string): Record<string, unknown>[] {
  return db
    .rows("jobs")
    .filter((row) => (row["payload"] as { template?: string }).template === template)
}

function withFleet(script: MockPrinterScript): void {
  gateway = new MockPrinterGateway({ [PRINTER]: script })
  deps = makeDeps()
}

beforeEach(() => {
  db = seed()
  gateway = new MockPrinterGateway({ [PRINTER]: MOCK_SCRIPT_HAPPY })
  deps = makeDeps()
})

describe("handlePrintPoll", () => {
  it("rejects a payload that names no job or no poll number", async () => {
    for (const payload of [{ printJobId: "pj_1" }, { printJobId: "", poll: 1 }, { poll: 0 }]) {
      const result = await handlePrintPoll(deps, payload)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("validation")
        expect(result.error.message).toBe("invalid print.poll payload")
      }
    }
  })

  it("walks a whole print: started, progressing, completed", async () => {
    await release()

    // Poll 1: the machine has picked the file up.
    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })).ok).toBe(true)
    expect(job()).toMatchObject({ status: "printing" })
    expect(order()).toMatchObject({ status: "printing" })
    expect(auditActions()).toEqual(["print_job.release", "print_job.started"])
    expect(pollJobs()).toHaveLength(2)

    // Poll 2: still going — nothing changes but the next poll is booked.
    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 2 })).ok).toBe(true)
    expect(job()).toMatchObject({ status: "printing" })
    expect(auditActions()).toHaveLength(2)
    expect(pollJobs()).toHaveLength(3)

    // Poll 3: the bed is free again, which is how a finished print reports itself.
    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 3 })).ok).toBe(true)
    expect(job()).toMatchObject({ status: "completed" })
    expect(order()).toMatchObject({ status: "quality_check" })
    expect(auditActions()).toEqual([
      "print_job.release",
      "print_job.started",
      "print_job.completed",
    ])
    // The loop stops: no fourth poll was booked.
    expect(pollJobs()).toHaveLength(3)
    expect(db.rows("printers")[0]).toMatchObject({ current_state: "idle" })
  })

  it("records a mid-print failure, requeues the order and alerts ops", async () => {
    withFleet(mockScriptFailsAt(40))
    await release()
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 }) // STARTED

    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 2 })
    expect(result.ok).toBe(true)

    expect(job()).toMatchObject({
      status: "failed",
      failure_reason: PRINT_FAILURE_REASONS.error,
    })
    // A failed print does not cancel the order — it goes back in the queue.
    expect(order()).toMatchObject({ status: "production_queued" })
    expect(db.rows("printers")[0]).toMatchObject({ current_state: "error" })

    expect(db.rows("audit_events").at(-1)).toMatchObject({
      actor_kind: "system",
      action: "print_job.failed",
      metadata: {
        orderId: "ord_1",
        printerId: PRINTER,
        attempt: 1,
        from: "printing",
        to: "failed",
        orderStatus: "production_queued",
        failureReason: PRINT_FAILURE_REASONS.error,
      },
    })

    expect(notifications("ops_print_failure")).toEqual([
      expect.objectContaining({
        idempotency_key: "ops_print_failure:pj_1:1",
        payload: {
          template: "ops_print_failure",
          orderId: "ord_1",
          printJobId: "pj_1",
          printerId: PRINTER,
          attempt: 1,
          failureReason: PRINT_FAILURE_REASONS.error,
        },
      }),
    ])
    // Nothing more is polled once it has failed.
    expect(pollJobs()).toHaveLength(2)
  })

  it("fails a print whose machine drops off the network mid-run", async () => {
    withFleet({ timeline: [{ state: "busy", progressPct: 5 }, { state: "offline" }] })
    await release()
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })

    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 2 })).ok).toBe(true)
    expect(job()).toMatchObject({
      status: "failed",
      failure_reason: PRINT_FAILURE_REASONS.offline,
    })
  })

  it("keeps waiting while a released job has not been picked up", async () => {
    withFleet({ timeline: [{ state: "idle" }] })
    await release()

    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })).ok).toBe(true)
    expect(job()).toMatchObject({ status: "released" })
    expect(pollJobs().map((row) => row["idempotency_key"])).toEqual([
      "print_poll:pj_1:1",
      "print_poll:pj_1:2",
    ])
  })

  it("stops polling a job that has already been cancelled", async () => {
    db = seed({ job: { status: "cancelled", gateway_job_ref: "mock-gw-1" } })
    deps = makeDeps()

    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 4 })).ok).toBe(true)
    expect(job()).toMatchObject({ status: "cancelled" })
    expect(auditActions()).toEqual([])
    expect(pollJobs()).toHaveLength(0)
  })

  /**
   * An operator may hold or cancel an order while a machine is printing. The
   * print's own outcome is a physical fact and must be recorded; the order must
   * stay where the operator put it.
   */
  it("tells the customer when their print starts and when it finishes", async () => {
    await release()
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 }) // → printing
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 2 }) // still printing
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 3 }) // → completed

    expect(notifications("production_milestone")).toEqual([
      expect.objectContaining({
        idempotency_key: "production_milestone:pj_1:1:started",
        payload: { template: "production_milestone", orderId: "ord_1", milestone: "started" },
      }),
      expect.objectContaining({
        idempotency_key: "production_milestone:pj_1:1:completed",
        payload: { template: "production_milestone", orderId: "ord_1", milestone: "completed" },
      }),
    ])
  })

  it("records the print but leaves an order an operator has moved", async () => {
    await release()
    await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 }) // → printing

    await db
      .from("orders")
      .update({ status: "on_hold", held_from_status: "printing" })
      .eq("id", "ord_1")

    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 2 })).ok).toBe(true)
    expect((await handlePrintPoll(deps, { printJobId: "pj_1", poll: 3 })).ok).toBe(true)

    expect(job()).toMatchObject({ status: "completed" })
    expect(order()).toMatchObject({ status: "on_hold" })
    expect(db.rows("audit_events").at(-1)).toMatchObject({
      action: "print_job.completed",
      metadata: { orderStatus: "on_hold", orderStatusUnchanged: true },
    })
    // The order did not move, so the customer is told nothing: "your print has
    // finished" would contradict the hold an operator deliberately put on it.
    expect(notifications("production_milestone")).toHaveLength(1)
  })

  const rejections = [
    ["a job that does not exist", { printJobId: "pj_missing", poll: 1 }, "not_found"],
  ] as const

  it.each(rejections)("reports %s", async (_label, payload, code) => {
    const result = await handlePrintPoll(deps, payload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(code)
  })

  it("refuses to poll a job that is not on a printer", async () => {
    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("precondition_failed")
      expect(result.error.message).toBe("this job is not on a printer")
    }
  })

  it("propagates an unreachable gateway rather than guessing", async () => {
    await release()
    vi.spyOn(gateway, "printerStatus").mockResolvedValue({
      ok: false,
      error: Object.assign(new Error("unreachable"), { code: "provider_error" as const }),
    })

    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("provider_error")
    expect(job()).toMatchObject({ status: "released" })
  })

  /**
   * A `pending` job cannot legally fail — it has not been released. Such a row
   * can only exist if something wrote a gateway ref without a release, so the
   * poller refuses it rather than forcing an illegal transition.
   */
  it("refuses an event the print-job machine does not allow from that state", async () => {
    withFleet({ restingState: "error" })
    db = seed({ job: { status: "pending", gateway_job_ref: "mock-gw-orphan" } })
    deps = makeDeps()

    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("conflict")
    expect(job()).toMatchObject({ status: "pending" })
  })

  it("reports an order that has gone missing under a live print job", async () => {
    db = seed({ job: { status: "printing", gateway_job_ref: "mock-gw-1", order_id: "ord_gone" } })
    gateway = new MockPrinterGateway({ [PRINTER]: { timeline: [{ state: "idle" }] } })
    deps = makeDeps()

    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.message).toBe("order ord_gone not found")
    }
  })

  it("propagates a failure to queue the ops alert about a failed print", async () => {
    db = seed({
      job: { status: "printing", gateway_job_ref: "mock-gw-1" },
      order: { status: "printing" },
    })
    withFleet({ restingState: "error" })
    // 1 job read · 2 printer state · 3 job status · 4 order read · 5 order write
    // · 6 audit event · 7 the notification job.
    db.failCall(7, { message: "db down" })

    const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
    expect(result.ok).toBe(false)
  })

  it("propagates a database failure at each step of a poll", async () => {
    await release()
    // A printing job on a machine that has just gone idle: the longest path
    // through a poll (job read, printer state, job status, order read, order
    // write, audit event, the customer's milestone mail).
    for (const call of [1, 2, 3, 4, 5, 6, 7]) {
      db = seed({
        job: { status: "printing", gateway_job_ref: "mock-gw-1" },
        order: { status: "printing" },
      })
      gateway = new MockPrinterGateway({ [PRINTER]: { timeline: [{ state: "idle" }] } })
      deps = makeDeps()
      db.failCall(call, { message: "db down" })

      const result = await handlePrintPoll(deps, { printJobId: "pj_1", poll: 1 })
      expect(result.ok).toBe(false)
    }
  })
})
