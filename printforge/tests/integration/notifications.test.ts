/**
 * The `notification.send` handler against the LOCAL Supabase stack (plan
 * §6-S16 step 1). The unit tests prove the rendering and the routing; this
 * proves what the real database ends up holding — one `notification_log` row per
 * attempt, with the template, the recipient and either a provider reference or
 * the reason it failed — and that a customer template really does address the
 * contact frozen on the order.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { Notifier } from "@/src/adapters/email"
import { MockNotifier } from "@/src/adapters/email/mock"
import type { Db } from "@/src/data/db"
import { handleNotificationSend } from "@/src/jobs/handlers/notification"
import { appError } from "@/src/lib/errors"
import { err } from "@/src/lib/result"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"
const APP_URL = "https://printforge.test"
const OPS_EMAIL = "ops@printforge.test"

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const db = client as unknown as Db

function tagFor(label: string): string {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A paid order with a real quote behind it, so a receipt has an amount to bill. */
async function seedOrder(tag: string): Promise<string> {
  const projectId = `proj_ntf_${tag}`
  const dvId = `dv_ntf_${tag}`
  const cfgId = `cfg_ntf_${tag}`
  const quoteId = `qt_ntf_${tag}`
  const orderId = `ord_ntf_${tag}`

  await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Notify" })
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
    status: "production_queued",
    payment_status: "paid",
    paid_at: new Date().toISOString(),
    contact_json: { name: "Asha Rao", email: "asha@example.com" },
    shipping_address_json: { line1: "12 Residency Road", city: "Bengaluru" },
    frozen_dv_id: dvId,
    frozen_config_json: { materialId: "pla", colorId: "pla-white" },
  })
  return orderId
}

async function logRows(orderId: string) {
  const { data } = await client
    .from("notification_log")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
  return (data ?? []) as {
    to_email: string
    template: string
    status: string
    message_ref: string | null
    error: string | null
  }[]
}

function deps(notifier: Notifier) {
  return { db, notifier, appUrl: APP_URL, opsEmail: OPS_EMAIL }
}

describe.skipIf(!RUN)("notification.send against Supabase", () => {
  it("mails every customer template to the contact frozen on the order", async () => {
    const orderId = await seedOrder(tagFor("cust"))
    const notifier = new MockNotifier()

    const payloads = [
      { template: "order_receipt" },
      { template: "review_hold" },
      { template: "production_milestone", milestone: "started" },
      { template: "shipment", carrier: "delhivery", trackingNumber: "DL1" },
      { template: "cancellation_refund" },
    ]
    for (const payload of payloads) {
      const result = await handleNotificationSend(deps(notifier), { ...payload, orderId })
      expect(result.ok).toBe(true)
    }

    const rows = await logRows(orderId)
    expect(rows.map((r) => r.template)).toEqual(payloads.map((p) => p.template))
    for (const row of rows) {
      expect(row.to_email).toBe("asha@example.com")
      expect(row.status).toBe("sent")
      expect(row.message_ref).toMatch(/^mock_/)
      expect(row.error).toBeNull()
    }
    expect(notifier.sent()[0]?.text).toContain("₹243.60")
  })

  it("logs an ops alert against its order but sends it to the ops inbox", async () => {
    const orderId = await seedOrder(tagFor("ops"))
    const notifier = new MockNotifier()

    const result = await handleNotificationSend(deps(notifier), {
      template: "ops_print_failure",
      orderId,
      printJobId: "pj_x",
      attempt: 2,
      failureReason: "thermal runaway",
    })
    expect(result.ok).toBe(true)

    const [row] = await logRows(orderId)
    expect(row?.template).toBe("ops_print_failure")
    expect(row?.to_email).toBe(OPS_EMAIL)
    expect(notifier.sent()[0]?.text).toContain(`${APP_URL}/ops/orders/${orderId}`)
  })

  it("records a refused send with its reason, and again on the retry", async () => {
    const orderId = await seedOrder(tagFor("fail"))
    const refusing: Notifier = {
      send: () => Promise.resolve(err(appError("provider_error", "resend failed with status 500"))),
    }

    for (const _attempt of [1, 2]) {
      const result = await handleNotificationSend(deps(refusing), {
        template: "review_hold",
        orderId,
      })
      expect(result.ok).toBe(false)
    }

    // One row per attempt: the log answers "what did we try to tell them", and
    // a silent retry would erase the evidence of the first failure.
    const rows = await logRows(orderId)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe("failed")
      expect(row.error).toContain("status 500")
      expect(row.message_ref).toBeNull()
    }
  })

  it("writes no log row at all when there is no order to address", async () => {
    const result = await handleNotificationSend(deps(new MockNotifier()), {
      template: "order_receipt",
      orderId: "ord_ntf_missing",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("not_found")
  })
})
