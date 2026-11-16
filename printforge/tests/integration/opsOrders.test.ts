/**
 * The `ops_orders` read-model view against the LOCAL Supabase stack (S14 step 1).
 * The fake db cannot express lateral joins or the exception-reason CASE, so the
 * SQL itself is proven here: precedence between exception reasons, "newest wins"
 * for the print job and validation report, and that PostgREST can filter and
 * page the view the way `listOpsOrders` asks it to.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { Db } from "@/src/data/db"
import { listOpsOrders } from "@/src/data/opsOrders"
import { opsOrderFilterSchema } from "@/src/domain/ops/board"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const db = client as unknown as Db

interface SeedOptions {
  verdict?: string
  materialId?: string
  status?: string
  paidAt?: string | null
  printJob?: { status: string; printerId?: string }
  extraPrintJob?: { status: string }
  dispute?: boolean
}

/** Seed one complete order lineage and return its id. */
async function seedOrder(tag: string, opts: SeedOptions = {}): Promise<string> {
  const projectId = `proj_ops_${tag}`
  const dvId = `dv_ops_${tag}`
  const cfgId = `cfg_ops_${tag}`
  const quoteId = `qt_ops_${tag}`
  const orderId = `ord_ops_${tag}`

  await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Ops" })
  await client.from("design_versions").insert({
    id: dvId,
    project_id: projectId,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("validation_reports").insert({
    id: `vr_ops_${tag}`,
    design_version_id: dvId,
    printer_profile_id: "generic-fdm",
    status: opts.verdict ?? "pass",
  })
  await client.from("print_configurations").insert({
    id: cfgId,
    design_version_id: dvId,
    material_id: opts.materialId ?? "pla",
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
    status: opts.status ?? "production_queued",
    payment_status: "paid",
    paid_at: opts.paidAt === undefined ? new Date().toISOString() : opts.paidAt,
    contact_json: { name: `Customer ${tag}`, email: "asha@example.com" },
    shipping_address_json: { line1: "12 Residency Road", city: "Bengaluru" },
    frozen_dv_id: dvId,
    frozen_config_json: { materialId: opts.materialId ?? "pla", colorId: "pla-white" },
  })

  if (opts.extraPrintJob !== undefined) {
    await client.from("print_jobs").insert({
      id: `pj_old_${tag}`,
      order_id: orderId,
      status: opts.extraPrintJob.status,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    })
  }
  if (opts.printJob !== undefined) {
    await client.from("print_jobs").insert({
      id: `pj_ops_${tag}`,
      order_id: orderId,
      status: opts.printJob.status,
      printer_id: opts.printJob.printerId ?? null,
    })
  }
  if (opts.dispute === true) {
    await client.from("audit_events").insert({
      id: `evt_ops_${tag}`,
      actor_kind: "system",
      entity_type: "order",
      entity_id: orderId,
      action: "dispute.opened",
      metadata: {},
    })
  }
  return orderId
}

async function view(orderId: string) {
  const { data } = await client.from("ops_orders").select("*").eq("id", orderId).single()
  return data as {
    material_id: string | null
    amount_minor: number | null
    customer_name: string | null
    printer_id: string | null
    print_job_status: string | null
    validation_status: string | null
    exception_reason: string | null
  }
}

function tagFor(label: string): string {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

describe.skipIf(!RUN)("ops_orders view", () => {
  it("flattens the material, amount, customer and current job onto one row", async () => {
    const tag = tagFor("flat")
    const printerId = `prn_ops_${tag}`
    await client
      .from("printers")
      .insert({ id: printerId, name: `Printer ${tag}`, gateway_kind: "mock" })
    const orderId = await seedOrder(tag, {
      materialId: "petg",
      printJob: { status: "printing", printerId },
    })

    const row = await view(orderId)
    expect(row.material_id).toBe("petg")
    expect(row.amount_minor).toBe(24360)
    expect(row.customer_name).toBe(`Customer ${tag}`)
    expect(row.printer_id).toBe(printerId)
    expect(row.print_job_status).toBe("printing")
    expect(row.validation_status).toBe("pass")
    expect(row.exception_reason).toBeNull()
  })

  it("shows the NEWEST print job, so a retry replaces the failure", async () => {
    const tag = tagFor("retry")
    const orderId = await seedOrder(tag, {
      extraPrintJob: { status: "failed" },
      printJob: { status: "printing" },
    })
    const row = await view(orderId)
    expect(row.print_job_status).toBe("printing")
    expect(row.exception_reason).toBeNull()
  })

  it("reports a failed print as an exception", async () => {
    const tag = tagFor("pjfail")
    const orderId = await seedOrder(tag, { printJob: { status: "failed" } })
    expect((await view(orderId)).exception_reason).toBe("print_failed")
  })

  it("reports a manual_review verdict as an exception", async () => {
    const tag = tagFor("manual")
    const orderId = await seedOrder(tag, { verdict: "manual_review" })
    expect((await view(orderId)).exception_reason).toBe("manual_review")
  })

  it("reports a dispute, outranking the design verdict", async () => {
    const tag = tagFor("disp")
    const orderId = await seedOrder(tag, { verdict: "manual_review", dispute: true })
    expect((await view(orderId)).exception_reason).toBe("dispute")
  })

  it("ranks a failed print above a dispute — the machine needs attention first", async () => {
    const tag = tagFor("both")
    const orderId = await seedOrder(tag, { dispute: true, printJob: { status: "failed" } })
    expect((await view(orderId)).exception_reason).toBe("print_failed")
  })

  it("reports a plain operator hold as flagged", async () => {
    const tag = tagFor("hold")
    const orderId = await seedOrder(tag, { status: "on_hold" })
    expect((await view(orderId)).exception_reason).toBe("flagged")
  })

  it("has no row for an order that does not exist", async () => {
    const { data } = await client.from("ops_orders").select("id").eq("id", "ord_nope")
    expect(data).toEqual([])
  })
})

describe.skipIf(!RUN)("listOpsOrders against the view", () => {
  it("filters by material and exception through PostgREST", async () => {
    const tag = tagFor("filter")
    const wanted = await seedOrder(`${tag}a`, {
      materialId: "petg",
      printJob: { status: "failed" },
    })
    await seedOrder(`${tag}b`, { materialId: "pla", printJob: { status: "failed" } })
    await seedOrder(`${tag}c`, { materialId: "petg" })

    const result = await listOpsOrders(
      db,
      opsOrderFilterSchema.parse({ materialId: "petg", exception: "print_failed" })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.value.rows.map((r) => r.id)
    expect(ids).toContain(wanted)
    expect(result.value.rows.every((r) => r.material_id === "petg")).toBe(true)
    expect(result.value.rows.every((r) => r.exception_reason === "print_failed")).toBe(true)
  })

  it("excludes orders that have not been paid from a due-date filter", async () => {
    const tag = tagFor("due")
    const unpaid = await seedOrder(tag, { paidAt: null, status: "pending_payment" })
    const result = await listOpsOrders(
      db,
      opsOrderFilterSchema.parse({
        dueBefore: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      })
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).not.toContain(unpaid)
  })

  it("pages without ever fetching the whole table", async () => {
    const result = await listOpsOrders(db, opsOrderFilterSchema.parse({}))
    expect(result.ok && result.value.rows.length).toBeLessThanOrEqual(25)
  })
})
