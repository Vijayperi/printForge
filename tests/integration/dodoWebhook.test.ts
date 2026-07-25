/**
 * The Dodo webhook sink against the LOCAL Supabase stack (plan §6-S13 step 3).
 * Bodies are signed by the mock provider and travel the REAL Standard Webhooks
 * verification path; the assertions are about what the real database ends up
 * holding — including the `webhook_events (provider, event_id)` unique index
 * that makes replays idempotent.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it, vi } from "vitest"

import type { Db } from "@/src/data/db"

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

vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: () => db }))

const { buildMockWebhook } = await import("@/src/adapters/payments/mock")
const { POST } = await import("@/app/api/webhooks/dodo/route")
const { inr } = await import("@/src/lib/money")

function webhookRequest(built: { rawBody: string; headers: Record<string, string> }): Request {
  return new Request("http://test/api/webhooks/dodo", {
    method: "POST",
    body: built.rawBody,
    headers: built.headers,
  })
}

async function statusOf(response: Response): Promise<string> {
  return ((await response.json()) as { status?: string }).status ?? ""
}

interface Seeded {
  orderId: string
  quoteId: string
  dvId: string
}

/** Seed a full paid-order lineage: project → design version → config → quote → order. */
async function seedOrder(tag: string, verdict: string): Promise<Seeded> {
  const projectId = `proj_wh_${tag}`
  const dvId = `dv_wh_${tag}`
  const cfgId = `cfg_wh_${tag}`
  const quoteId = `qt_wh_${tag}`
  const orderId = `ord_wh_${tag}`

  await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Webhook" })
  await client.from("design_versions").insert({
    id: dvId,
    project_id: projectId,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("validation_reports").insert({
    id: `vr_wh_${tag}`,
    design_version_id: dvId,
    printer_profile_id: "generic-fdm",
    status: verdict,
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
    config_hash: "1|pla|standard|everyday|standard",
    status: "consumed",
    amount_minor: 24360,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  await client.from("orders").insert({
    id: orderId,
    user_id: ADMIN_UID,
    quote_id: quoteId,
    contact_json: { name: "Asha", email: "asha@example.com", phone: "+919876543210" },
    shipping_address_json: { line1: "12 Residency Road", city: "Bengaluru", pincode: "560025" },
    frozen_dv_id: dvId,
    frozen_config_json: { materialId: "pla" },
  })

  return { orderId, quoteId, dvId }
}

async function readOrder(orderId: string) {
  const { data } = await client
    .from("orders")
    .select("status, payment_status, payment_ref, held_from_status")
    .eq("id", orderId)
    .single()
  return data as {
    status: string
    payment_status: string
    payment_ref: string | null
    held_from_status: string | null
  }
}

async function webhookRows(eventId: string) {
  const { data } = await client
    .from("webhook_events")
    .select("id, processing_result")
    .eq("provider", "dodo")
    .eq("event_id", eventId)
  return (data ?? []) as { id: string; processing_result: string | null }[]
}

describe.skipIf(!RUN)("POST /api/webhooks/dodo against Supabase", () => {
  beforeAll(() => {
    // The route resolves the mock provider, whose secret signs the bodies below.
    delete process.env["PAYMENT_PROVIDER"]
  })

  it("settles a passing order and is idempotent on replay", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "pass")

    const built = buildMockWebhook({
      type: "payment.succeeded",
      orderId,
      quoteId,
      amount: inr(24360),
    })
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("processed")

    const settled = await readOrder(orderId)
    expect(settled.status).toBe("production_queued")
    expect(settled.payment_status).toBe("paid")
    expect(settled.payment_ref).toBe(`pay_mock_${orderId}`)

    // Same event id again: the unique index makes it a duplicate, not a re-run.
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("duplicate")
    const rows = await webhookRows(built.headers["webhook-id"]!)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.processing_result).toBe("processed")

    // A NEW event id for an order that is already paid changes nothing either.
    const replay = buildMockWebhook(
      { type: "payment.succeeded", orderId, quoteId, amount: inr(24360) },
      { eventId: `evt_replay_${tag}` }
    )
    expect(await statusOf(await POST(webhookRequest(replay)))).toBe("already_paid")
    expect((await readOrder(orderId)).status).toBe("production_queued")
  })

  it("stops a warning verdict in design_review and queues an ops review", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "warning")

    const built = buildMockWebhook({
      type: "payment.succeeded",
      orderId,
      quoteId,
      amount: inr(24360),
    })
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("processed")
    expect((await readOrder(orderId)).status).toBe("design_review")

    const { data } = await client
      .from("jobs")
      .select("idempotency_key")
      .eq("idempotency_key", `ops_order_review:${orderId}`)
    expect(data).toHaveLength(1)
  })

  it("cancels an order whose payment failed", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "pass")

    const built = buildMockWebhook({ type: "payment.failed", orderId, quoteId })
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("processed")
    const after = await readOrder(orderId)
    expect(after.status).toBe("cancelled")
    expect(after.payment_status).toBe("unpaid")
  })

  it("records late money on a cancelled order rather than dropping it", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "pass")
    await client.from("orders").update({ status: "cancelled" }).eq("id", orderId)

    const built = buildMockWebhook({
      type: "payment.succeeded",
      orderId,
      quoteId,
      amount: inr(24360),
    })
    expect(await statusOf(await POST(webhookRequest(built)))).toBe(
      "late_payment_on_cancelled_order"
    )
    const after = await readOrder(orderId)
    expect(after.status).toBe("cancelled")
    expect(after.payment_status).toBe("paid")

    const { data } = await client
      .from("audit_events")
      .select("action")
      .eq("entity_id", orderId)
      .eq("action", "payment.late_on_cancelled_order")
    expect(data).toHaveLength(1)
  })

  it("moves only the payment axis for a refund, and holds on a dispute", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "pass")

    await POST(
      webhookRequest(
        buildMockWebhook({ type: "payment.succeeded", orderId, quoteId, amount: inr(24360) })
      )
    )

    const partial = buildMockWebhook(
      { type: "refund.succeeded", orderId, amount: inr(5000) },
      { eventId: `evt_refund_${tag}` }
    )
    expect(await statusOf(await POST(webhookRequest(partial)))).toBe("processed")
    const refunded = await readOrder(orderId)
    expect(refunded.payment_status).toBe("partially_refunded")
    expect(refunded.status).toBe("production_queued")

    const dispute = buildMockWebhook(
      { type: "dispute.opened", orderId },
      { eventId: `evt_dispute_${tag}` }
    )
    expect(await statusOf(await POST(webhookRequest(dispute)))).toBe("processed")
    const held = await readOrder(orderId)
    expect(held.status).toBe("on_hold")
    expect(held.held_from_status).toBe("production_queued")
  })

  it("logs an out-of-order refund without touching any order", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId } = await seedOrder(tag, "pass")

    const built = buildMockWebhook(
      { type: "refund.succeeded", orderId, amount: inr(24360) },
      { eventId: `evt_early_refund_${tag}` }
    )
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("out_of_order")
    const untouched = await readOrder(orderId)
    expect(untouched.status).toBe("pending_payment")
    expect(untouched.payment_status).toBe("unpaid")
    expect((await webhookRows(`evt_early_refund_${tag}`))[0]!.processing_result).toBe(
      "out_of_order"
    )
  })

  it("logs an unknown event type and ACKs it", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const built = buildMockWebhook(
      { type: "ignored", rawType: "subscription.renewed" },
      { eventId: `evt_ignored_${tag}` }
    )
    expect(await statusOf(await POST(webhookRequest(built)))).toBe("ignored")
    expect((await webhookRows(`evt_ignored_${tag}`))[0]!.processing_result).toBe("ignored")
  })

  it("rejects a tampered body and a stale timestamp without storing anything", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { orderId, quoteId } = await seedOrder(tag, "pass")

    const built = buildMockWebhook(
      { type: "payment.succeeded", orderId, quoteId, amount: inr(24360) },
      { eventId: `evt_tampered_${tag}` }
    )
    const tampered = new Request("http://test/api/webhooks/dodo", {
      method: "POST",
      body: built.rawBody.replace("24360", "1"),
      headers: built.headers,
    })
    expect((await POST(tampered)).status).toBe(401)

    const stale = buildMockWebhook(
      { type: "payment.succeeded", orderId, quoteId, amount: inr(24360) },
      { eventId: `evt_stale_${tag}`, at: new Date(Date.now() - 20 * 60 * 1000) }
    )
    expect((await POST(webhookRequest(stale))).status).toBe(401)

    expect(await webhookRows(`evt_tampered_${tag}`)).toHaveLength(0)
    expect(await webhookRows(`evt_stale_${tag}`)).toHaveLength(0)
    expect((await readOrder(orderId)).status).toBe("pending_payment")
  })
})
