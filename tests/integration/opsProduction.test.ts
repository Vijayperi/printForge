/**
 * The print-job and shipment routes against the LOCAL Supabase stack (plan
 * §6-S14 steps 4). The unit tests prove the guards; this proves what the real
 * database ends up holding once a whole print walks through: the attempt counter
 * and its cap, the audit row every action leaves behind, and that shipping an
 * order writes the tracking number *before* the status and queues exactly one
 * notification.
 *
 * S14 has nothing that fires RELEASE/STARTED/COMPLETED (that is Session 15's
 * poller), so the `printing`/`completed` legs are seeded directly here — the
 * same way the ops e2e journey seeds them.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Db } from "@/src/data/db"
import { ok } from "@/src/lib/result"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"
const PRINTER_ID = "prn_01K0PRNSEED000000000000001"

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const db = client as unknown as Db

vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: () => db }))

// The 404-not-403 guard is unit-tested on every route; here every request is a
// signed-in operator so the assertions can be about database effects.
vi.mock("@/src/lib/opsAuth", () => ({
  requireOperator: async () =>
    ok({ userId: ADMIN_UID, email: "ops@printforge.test", name: "Ops", role: "operator" }),
}))

const { POST: createJob } = await import("@/app/api/ops/orders/[id]/print-jobs/route")
const { POST: assign } = await import("@/app/api/ops/print-jobs/[id]/assign/route")
const { POST: retry } = await import("@/app/api/ops/print-jobs/[id]/retry/route")
const { POST: cancel } = await import("@/app/api/ops/print-jobs/[id]/cancel/route")
const { POST: qc } = await import("@/app/api/ops/print-jobs/[id]/qc/route")
const { POST: ship } = await import("@/app/api/ops/orders/[id]/shipment/route")
const { MAX_PRINT_ATTEMPTS } = await import("@/src/domain/ops/production")

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>

function call(handler: Handler, id: string, body: unknown): Promise<Response> {
  return handler(
    new Request("http://test/api/ops", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  )
}

function tagFor(label: string): string {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Seed a paid, approved order sitting in `production_queued`. */
async function seedOrder(tag: string, status = "production_queued"): Promise<string> {
  const projectId = `proj_prod_${tag}`
  const dvId = `dv_prod_${tag}`
  const cfgId = `cfg_prod_${tag}`
  const quoteId = `qt_prod_${tag}`
  const orderId = `ord_prod_${tag}`

  await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Production" })
  await client.from("design_versions").insert({
    id: dvId,
    project_id: projectId,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("print_configurations").insert({
    id: cfgId,
    design_version_id: dvId,
    material_id: "pla",
    color_id: "pla-white",
    dimensions_mm: { x: 10, y: 10, z: 10 },
    scale_factor: 1,
    quality_id: "standard",
    strength_id: "everyday",
    shipping_speed: "standard",
  })
  await client.from("quotes").insert({
    id: quoteId,
    configuration_id: cfgId,
    config_hash: `h_${tag}`,
    status: "consumed",
    amount_minor: 24360,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  await client.from("orders").insert({
    id: orderId,
    user_id: ADMIN_UID,
    quote_id: quoteId,
    status,
    payment_status: "paid",
    paid_at: new Date().toISOString(),
    contact_json: { name: "Asha Rao", email: "asha@example.com" },
    shipping_address_json: { line1: "12 Residency Road", city: "Bengaluru" },
    frozen_dv_id: dvId,
    frozen_config_json: { materialId: "pla", colorId: "pla-white" },
  })
  return orderId
}

async function orderStatus(orderId: string): Promise<{ status: string; payment_status: string }> {
  const { data } = await client
    .from("orders")
    .select("status, payment_status")
    .eq("id", orderId)
    .single()
  return data as { status: string; payment_status: string }
}

async function jobRow(jobId: string) {
  const { data } = await client.from("print_jobs").select("*").eq("id", jobId).single()
  return data as {
    status: string
    attempt: number
    printer_id: string | null
    failure_reason: string | null
  }
}

async function auditActions(entityId: string): Promise<string[]> {
  const { data } = await client
    .from("audit_events")
    .select("action, actor_id")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true })
  return (data ?? []).map((row) => (row as { action: string }).action)
}

/** Walk a pending job to `completed` the way S15's poller eventually will. */
async function finishPrint(jobId: string, orderId: string): Promise<void> {
  await client.from("print_jobs").update({ status: "completed" }).eq("id", jobId)
  await client.from("orders").update({ status: "quality_check" }).eq("id", orderId)
}

async function newJobId(orderId: string, reason = "queued by ops"): Promise<string> {
  const response = await call(createJob, orderId, { reason })
  expect(response.status).toBe(201)
  return ((await response.json()) as { printJobId: string }).printJobId
}

describe.skipIf(!RUN)("ops production lifecycle", () => {
  it("walks create → assign → quality check → shipment and ships the order", async () => {
    const orderId = await seedOrder(tagFor("happy"))
    const jobId = await newJobId(orderId)

    expect(await jobRow(jobId)).toMatchObject({ status: "pending", attempt: 1, printer_id: null })

    const assigned = await call(assign, jobId, {
      printerId: PRINTER_ID,
      reason: "bay 1 is free",
    })
    expect(assigned.status).toBe(200)
    expect((await jobRow(jobId)).printer_id).toBe(PRINTER_ID)

    await finishPrint(jobId, orderId)

    const checked = await call(qc, jobId, { outcome: "pass", reason: "dimensions within spec" })
    expect(checked.status).toBe(200)
    expect(await checked.json()).toMatchObject({ awaitingShipment: true })
    // A pass does not move the order — §4.3 ships on "QC_PASSED + tracking added".
    expect((await orderStatus(orderId)).status).toBe("quality_check")

    const shipped = await call(ship, orderId, {
      carrier: "blue_dart",
      trackingNumber: "BD-77881122",
    })
    expect(shipped.status).toBe(201)
    const { shipmentId } = (await shipped.json()) as { shipmentId: string }

    expect((await orderStatus(orderId)).status).toBe("shipped")
    const { data: shipment } = await client
      .from("shipments")
      .select("carrier, tracking_number")
      .eq("id", shipmentId)
      .single()
    expect(shipment).toMatchObject({ carrier: "blue_dart", tracking_number: "BD-77881122" })

    // Exactly one shipped notification, keyed by the shipment.
    const { data: jobs } = await client
      .from("jobs")
      .select("type, idempotency_key")
      .eq("idempotency_key", `shipment:${shipmentId}`)
    expect(jobs).toHaveLength(1)
    expect(jobs?.[0]).toMatchObject({ type: "notification.send" })

    expect(await auditActions(jobId)).toEqual([
      "print_job.created",
      "print_job.assigned",
      "print_job.qc.pass",
    ])
    expect(await auditActions(orderId)).toContain("order.shipped")
  })

  it("sends a failed quality check back to production and reprints on the next attempt", async () => {
    const orderId = await seedOrder(tagFor("qcfail"))
    const firstJob = await newJobId(orderId)
    await finishPrint(firstJob, orderId)

    const failed = await call(qc, firstJob, { outcome: "fail", reason: "layer shift at 40mm" })
    expect(failed.status).toBe(200)
    expect((await orderStatus(orderId)).status).toBe("production_queued")

    // The reprint is the order's SECOND print, not a retry of the same job.
    const secondJob = await newJobId(orderId, "reprint after qc failure")
    expect((await jobRow(secondJob)).attempt).toBe(2)
  })

  it("refuses a fourth print once the order has burned its three attempts", async () => {
    const orderId = await seedOrder(tagFor("cap"))

    for (let attempt = 1; attempt <= MAX_PRINT_ATTEMPTS; attempt += 1) {
      const jobId = await newJobId(orderId, `print ${attempt}`)
      expect((await jobRow(jobId)).attempt).toBe(attempt)
      await finishPrint(jobId, orderId)
      await call(qc, jobId, { outcome: "fail", reason: "failed inspection" })
    }

    const refused = await call(createJob, orderId, { reason: "one more" })
    expect(refused.status).toBe(412)
    expect(await refused.json()).toMatchObject({
      error: { message: expect.stringContaining("escalate instead of reprinting") },
    })
  })

  it("retries a failed print in place, clearing the stale failure reason", async () => {
    const orderId = await seedOrder(tagFor("retry"))
    const jobId = await newJobId(orderId)
    await client
      .from("print_jobs")
      .update({ status: "failed", failure_reason: "thermal runaway" })
      .eq("id", jobId)

    const retried = await call(retry, jobId, { reason: "nozzle cleaned" })
    expect(retried.status).toBe(200)
    expect(await jobRow(jobId)).toMatchObject({
      status: "pending",
      attempt: 2,
      failure_reason: null,
    })
    expect(await auditActions(jobId)).toContain("print_job.retry")
  })

  it("cancels a print and frees the order for a fresh one", async () => {
    const orderId = await seedOrder(tagFor("cancel"))
    const jobId = await newJobId(orderId)

    const cancelled = await call(cancel, jobId, { reason: "customer changed the colour" })
    expect(cancelled.status).toBe(200)
    expect((await jobRow(jobId)).status).toBe("cancelled")
    expect(await auditActions(jobId)).toContain("print_job.cancel")

    // A cancelled job never printed, so it does not spend one of the three attempts.
    const replacement = await newJobId(orderId, "requeued")
    expect((await jobRow(replacement)).attempt).toBe(1)
  })

  it("refuses a second active print job on the same order", async () => {
    const orderId = await seedOrder(tagFor("dup"))
    await newJobId(orderId)

    const refused = await call(createJob, orderId, { reason: "again" })
    expect(refused.status).toBe(412)
    expect(await refused.json()).toMatchObject({
      error: { message: expect.stringContaining("still active") },
    })
  })

  it("refuses to ship an order that is not through quality check", async () => {
    const orderId = await seedOrder(tagFor("early"))

    const refused = await call(ship, orderId, { carrier: "dtdc", trackingNumber: "DT-1234" })
    expect(refused.status).toBe(409)
    const { data: shipments } = await client
      .from("shipments")
      .select("id")
      .eq("order_id", orderId)
    expect(shipments).toHaveLength(0)
    expect((await orderStatus(orderId)).status).toBe("production_queued")
  })

  it("refuses to print an unpaid order", async () => {
    const orderId = await seedOrder(tagFor("unpaid"))
    await client.from("orders").update({ payment_status: "unpaid" }).eq("id", orderId)

    const refused = await call(createJob, orderId, { reason: "jumping the gun" })
    expect(refused.status).toBe(412)
    expect(await refused.json()).toMatchObject({
      error: { message: "this order has not been paid" },
    })
  })
})
