/**
 * Dispatch and the status poller against the LOCAL Supabase stack (plan §6-S15
 * steps 2 and 4). The unit tests prove the mapping and the guards; this proves
 * what the real database ends up holding — including the one rule that only
 * Postgres can enforce: the partial unique index that stops two jobs from being
 * released to the same machine.
 *
 * The fleet itself is the mock gateway: a real OctoPrint is not available in CI,
 * and the gateway's own behaviour is covered by the contract suite both
 * implementations run.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Db } from "@/src/data/db"
import { SystemClock } from "@/src/lib/clock"
import { ok } from "@/src/lib/result"
import {
  fakeGateway,
  MOCK_SCRIPT_HAPPY,
  mockScriptFailsAt,
  type MockPrinterGateway,
} from "@/tests/helpers/fakeGateway"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"
const BAY_1 = "prn_01K0PRNSEED000000000000001"
const BAY_2 = "prn_01K0PRNSEED000000000000002"

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const db = client as unknown as Db

let gateway: MockPrinterGateway

vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: () => db }))
vi.mock("@/src/lib/opsAuth", () => ({
  requireOperator: async () =>
    ok({ userId: ADMIN_UID, email: "ops@printforge.test", name: "Ops", role: "operator" }),
}))
vi.mock("@/src/jobs/dispatchDeps", () => ({
  getDispatchDeps: () => deps(),
}))

const { POST: release } = await import("@/app/api/ops/print-jobs/[id]/release/route")
const { POST: cancel } = await import("@/app/api/ops/print-jobs/[id]/cancel/route")
const { handlePrintPoll } = await import("@/src/jobs/handlers/printPoll")
const { PostgresJobQueue } = await import("@/src/jobs/queue")
const { PRINT_FAILURE_REASONS } = await import("@/src/domain/printDispatch")

function deps() {
  const clock = new SystemClock()
  return { db, gateway, queue: new PostgresJobQueue(db, clock), clock }
}

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

function call(handler: Handler, id: string, body: unknown): Promise<Response> {
  return handler(
    new Request("http://test/api/ops", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  )
}

function tagFor(label: string): string {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * A paid, approved order with a sliced gcode asset and a print job on a machine:
 * everything the dispatch guard asks for.
 */
async function seedDispatchable(
  tag: string,
  over: { orderStatus?: string; paymentStatus?: string; printerId?: string; withGcode?: boolean } = {}
): Promise<{ orderId: string; jobId: string }> {
  const ids = {
    project: `proj_disp_${tag}`,
    dv: `dv_disp_${tag}`,
    cfg: `cfg_disp_${tag}`,
    quote: `qt_disp_${tag}`,
    order: `ord_disp_${tag}`,
    asset: `ast_disp_${tag}`,
    job: `pj_disp_${tag}`,
  }

  await client.from("projects").insert({ id: ids.project, user_id: ADMIN_UID, title: "Dispatch" })
  await client.from("design_versions").insert({
    id: ids.dv,
    project_id: ids.project,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("validation_reports").insert({
    id: `vr_disp_${tag}`,
    design_version_id: ids.dv,
    printer_profile_id: "generic-fdm",
    status: "pass",
  })
  await client.from("print_configurations").insert({
    id: ids.cfg,
    design_version_id: ids.dv,
    material_id: "pla",
    color_id: "pla-white",
    dimensions_mm: { x: 10, y: 10, z: 10 },
    scale_factor: 1,
    quality_id: "standard",
    strength_id: "everyday",
    shipping_speed: "standard",
  })
  await client.from("quotes").insert({
    id: ids.quote,
    configuration_id: ids.cfg,
    config_hash: `h_${tag}`,
    status: "consumed",
    amount_minor: 24360,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  await client.from("orders").insert({
    id: ids.order,
    user_id: ADMIN_UID,
    quote_id: ids.quote,
    status: over.orderStatus ?? "production_queued",
    payment_status: over.paymentStatus ?? "paid",
    paid_at: new Date().toISOString(),
    contact_json: { name: "Asha Rao", email: "asha@example.com" },
    shipping_address_json: { line1: "12 Residency Road", city: "Bengaluru" },
    frozen_dv_id: ids.dv,
    frozen_config_json: { materialId: "pla", colorId: "pla-white" },
  })
  if (over.withGcode !== false) {
    await client.from("assets").insert({
      id: ids.asset,
      type: "gcode",
      storage_key: `gcode/${tag}.gcode`,
      checksum_sha256: "0".repeat(64),
      bytes: 2048,
      mime: "text/plain",
    })
  }
  await client.from("print_jobs").insert({
    id: ids.job,
    order_id: ids.order,
    printer_id: over.printerId ?? BAY_1,
    status: "pending",
    gcode_asset_id: over.withGcode === false ? null : ids.asset,
    attempt: 1,
  })
  return { orderId: ids.order, jobId: ids.job }
}

async function jobRow(jobId: string) {
  const { data } = await client.from("print_jobs").select("*").eq("id", jobId).single()
  return data as {
    status: string
    attempt: number
    printer_id: string | null
    gateway_job_ref: string | null
    failure_reason: string | null
  }
}

async function orderStatus(orderId: string): Promise<string> {
  const { data } = await client.from("orders").select("status").eq("id", orderId).single()
  return (data as { status: string }).status
}

async function printerState(printerId: string): Promise<string> {
  const { data } = await client.from("printers").select("current_state").eq("id", printerId).single()
  return (data as { current_state: string }).current_state
}

async function auditActions(entityId: string): Promise<string[]> {
  const { data } = await client
    .from("audit_events")
    .select("action")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true })
  return (data ?? []).map((row) => (row as { action: string }).action)
}

async function queuedJobs(type: string, key: string): Promise<Record<string, unknown>[]> {
  const { data } = await client.from("jobs").select("*").eq("type", type).like("idempotency_key", key)
  return (data ?? []) as Record<string, unknown>[]
}

/**
 * Free both seeded bays. Not politeness: the release interlock is a *database*
 * unique index, so a job another test left `released` on bay 1 makes the next
 * release fail with a conflict — which is the index doing its job, and exactly
 * why each test has to start from an empty fleet.
 */
async function freeFleet(): Promise<void> {
  await client
    .from("print_jobs")
    .update({ status: "cancelled" })
    .in("printer_id", [BAY_1, BAY_2])
    .in("status", ["released", "printing"])
  await client.from("printers").update({ current_state: "idle" }).in("id", [BAY_1, BAY_2])
}

beforeEach(async () => {
  gateway = fakeGateway()
  await freeFleet()
})

describe.skipIf(!RUN)("print dispatch and polling", () => {
  it("releases a job, then walks it to completed through the poller", async () => {
    // Three ticks: busy, busy, idle — one poll each.
    gateway = fakeGateway({ [BAY_1]: MOCK_SCRIPT_HAPPY })
    const tag = tagFor("happy")
    const { orderId, jobId } = await seedDispatchable(tag)

    const released = await call(release, jobId, { reason: "bay 1 is loaded with white PLA" })
    expect(released.status).toBe(200)

    const afterRelease = await jobRow(jobId)
    expect(afterRelease.status).toBe("released")
    expect(afterRelease.gateway_job_ref).not.toBeNull()
    expect(await printerState(BAY_1)).toBe("busy")

    // The dispatch booked the first poll rather than polling inline.
    expect(await queuedJobs("print.poll", `print_poll:${jobId}:%`)).toHaveLength(1)

    // Poll 1: the machine has started.
    expect((await handlePrintPoll(deps(), { printJobId: jobId, poll: 1 })).ok).toBe(true)
    expect((await jobRow(jobId)).status).toBe("printing")
    expect(await orderStatus(orderId)).toBe("printing")

    // Poll 2: still printing. Poll 3: the bed is free, so the print is done.
    expect((await handlePrintPoll(deps(), { printJobId: jobId, poll: 2 })).ok).toBe(true)
    expect((await handlePrintPoll(deps(), { printJobId: jobId, poll: 3 })).ok).toBe(true)

    expect((await jobRow(jobId)).status).toBe("completed")
    expect(await orderStatus(orderId)).toBe("quality_check")
    expect(await printerState(BAY_1)).toBe("idle")
    expect(await auditActions(jobId)).toEqual([
      "print_job.release",
      "print_job.started",
      "print_job.completed",
    ])
    // The loop stopped: no poll was booked after the completing one.
    expect(await queuedJobs("print.poll", `print_poll:${jobId}:%`)).toHaveLength(3)
  })

  it("answers a second release with 409 and never starts a second print", async () => {
    const { jobId } = await seedDispatchable(tagFor("dupe"))

    expect((await call(release, jobId, { reason: "first press" })).status).toBe(200)
    const ref = (await jobRow(jobId)).gateway_job_ref

    const again = await call(release, jobId, { reason: "impatient second press" })
    expect(again.status).toBe(409)
    expect((await jobRow(jobId)).gateway_job_ref).toBe(ref)
    expect(await auditActions(jobId)).toEqual(["print_job.release"])
  })

  /**
   * The safety interlock of plan §6-S15 step 2. Everything else is enforced in
   * the domain; *this* one is enforced by Postgres, so it holds even against a
   * race two application-level checks would both pass.
   */
  it("refuses to hold two jobs on the same machine at the database level", async () => {
    const first = await seedDispatchable(tagFor("lockA"), { printerId: BAY_2 })
    const second = await seedDispatchable(tagFor("lockB"), { printerId: BAY_2 })

    expect((await call(release, first.jobId, { reason: "bay 2 is free" })).status).toBe(200)

    const { error } = await client
      .from("print_jobs")
      .update({ status: "released" })
      .eq("id", second.jobId)
    expect(error?.code).toBe("23505")
    expect((await jobRow(second.jobId)).status).toBe("pending")
  })

  it("frees the bay when a released job is cancelled", async () => {
    const { jobId } = await seedDispatchable(tagFor("cancel"))
    expect((await call(release, jobId, { reason: "queued" })).status).toBe(200)
    const ref = (await jobRow(jobId)).gateway_job_ref as string

    const cancelled = await call(cancel, jobId, { reason: "customer changed the colour" })
    expect(cancelled.status).toBe(200)
    expect(gateway.wasCancelled(ref)).toBe(true)
    expect((await jobRow(jobId)).status).toBe("cancelled")
    expect(await printerState(BAY_1)).toBe("idle")

    // The bay is genuinely free: the interlock lets the next job onto it.
    const next = await seedDispatchable(tagFor("after"))
    expect((await call(release, next.jobId, { reason: "next order" })).status).toBe(200)
  })

  it("records a failed print, requeues the order and queues one ops alert", async () => {
    gateway = fakeGateway({ [BAY_1]: mockScriptFailsAt(35) })
    const { orderId, jobId } = await seedDispatchable(tagFor("fail"))

    expect((await call(release, jobId, { reason: "queued" })).status).toBe(200)
    expect((await handlePrintPoll(deps(), { printJobId: jobId, poll: 1 })).ok).toBe(true)
    expect((await handlePrintPoll(deps(), { printJobId: jobId, poll: 2 })).ok).toBe(true)

    expect(await jobRow(jobId)).toMatchObject({
      status: "failed",
      failure_reason: PRINT_FAILURE_REASONS.error,
    })
    // Failing a print does not cancel the order — it goes back in the queue.
    expect(await orderStatus(orderId)).toBe("production_queued")
    expect(await printerState(BAY_1)).toBe("error")

    expect(await queuedJobs("notification.send", `ops_print_failure:${jobId}:%`)).toHaveLength(1)
    expect(await auditActions(jobId)).toEqual([
      "print_job.release",
      "print_job.started",
      "print_job.failed",
    ])
  })

  it("refuses to dispatch a job with no gcode, and tells the operator why", async () => {
    const { jobId } = await seedDispatchable(tagFor("nogcode"), { withGcode: false })

    const response = await call(release, jobId, { reason: "let us try anyway" })
    expect(response.status).toBe(412)
    await expect(response.json()).resolves.toEqual({
      error: { code: "precondition_failed", message: "this job has no sliced gcode to send" },
    })
    expect((await jobRow(jobId)).status).toBe("pending")
    expect(await printerState(BAY_1)).toBe("idle")
  })

  it("refuses to dispatch an order that has not been approved for production", async () => {
    const { jobId } = await seedDispatchable(tagFor("unapproved"), { orderStatus: "design_review" })

    const response = await call(release, jobId, { reason: "jumping the queue" })
    expect(response.status).toBe(412)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "this order is not queued for production" },
    })
    expect((await jobRow(jobId)).status).toBe("pending")
  })
})
