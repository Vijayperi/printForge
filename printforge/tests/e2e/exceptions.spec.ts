import { createClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

import { buildMockWebhook, mockPaymentRef } from "@/src/adapters/payments/mock"

/**
 * The two exception journeys from plan §6-S16 step 4: an operator rejecting a
 * design under manual review (which refunds the customer), and a payment dispute
 * freezing an order that is already in production.
 *
 * Both start from a seeded paid order rather than a browser-driven checkout —
 * `checkout.spec.ts` already walks the whole prompt → pay path, and repeating it
 * here would only make these slower and flakier. What is driven live is the part
 * these journeys are about: the operator's decision, the webhook, and what the
 * customer is shown afterwards.
 *
 * Requires the local Supabase stack (seeded users). Skipped unless E2E_SUPABASE=1.
 */

const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

const CUSTOMER_UID = "a0000000-0000-4000-8000-000000000003"
const CUSTOMER_EMAIL = "customer1@printforge.test"
const OPERATOR_EMAIL = "operator@printforge.test"
const PASSWORD = "printforge-dev-123"
const AMOUNT_MINOR = 24360

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface SeededOrder {
  orderId: string
  paymentRef: string
}

/**
 * A paid order with a `manual_review` printability verdict, sitting in design
 * review exactly where the payment webhook leaves one.
 */
async function seedOrder(status: string, verdict = "manual_review"): Promise<SeededOrder> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const projectId = `proj_e2eexc_${tag}`
  const dvId = `dv_e2eexc_${tag}`
  const cfgId = `cfg_e2eexc_${tag}`
  const quoteId = `qt_e2eexc_${tag}`
  const orderId = `ord_e2eexc_${tag}`
  // The ref the mock provider derives, so a webhook for this order matches it.
  const paymentRef = mockPaymentRef(orderId)

  await client.from("projects").insert({ id: projectId, user_id: CUSTOMER_UID, title: "Exceptions" })
  await client.from("design_versions").insert({
    id: dvId,
    project_id: projectId,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("validation_reports").insert({
    id: `vr_e2eexc_${tag}`,
    design_version_id: dvId,
    printer_profile_id: "generic-fdm",
    status: verdict,
  })
  await client.from("print_configurations").insert({
    id: cfgId,
    design_version_id: dvId,
    material_id: "pla",
    color_id: "pla-white",
    dimensions_mm: { x: 40, y: 40, z: 40 },
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
    amount_minor: AMOUNT_MINOR,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  await client.from("orders").insert({
    id: orderId,
    user_id: CUSTOMER_UID,
    quote_id: quoteId,
    status,
    payment_status: "paid",
    payment_ref: paymentRef,
    paid_at: new Date().toISOString(),
    contact_json: { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" },
    shipping_address_json: {
      line1: "12 Residency Road",
      line2: "",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560025",
      country: "IN",
    },
    frozen_dv_id: dvId,
    frozen_config_json: {
      configurationId: cfgId,
      materialId: "pla",
      colorId: "pla-white",
      dimensionsMm: { x: 40, y: 40, z: 40 },
      scaleFactor: 1,
      qualityId: "standard",
      strengthId: "everyday",
      shippingSpeed: "standard",
      specialInstructions: "",
    },
  })
  return { orderId, paymentRef }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Log in" }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

/** Run one reason-bearing ops control: open its dialog, justify it, confirm. */
async function act(page: Page, name: string | RegExp, reason: string): Promise<void> {
  await page.getByRole("button", { name }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel(/Reason/).fill(reason)
  await dialog.getByRole("button", { name: "Confirm" }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

async function orderRow(orderId: string) {
  const { data } = await client
    .from("orders")
    .select("status, payment_status, held_from_status")
    .eq("id", orderId)
    .single()
  return data as { status: string; payment_status: string; held_from_status: string | null }
}

/** Queued `notification.send` jobs for one template, however they were keyed. */
async function notificationJobs(template: string, orderId: string): Promise<number> {
  const { data } = await client
    .from("jobs")
    .select("payload")
    .eq("type", "notification.send")
    .like("idempotency_key", `${template}:%`)
  return (data ?? []).filter(
    (row) => (row as { payload: { orderId?: string } }).payload.orderId === orderId
  ).length
}

test.describe("exception journeys (Supabase)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase (set E2E_SUPABASE=1)")

  test("manual review → operator rejects → customer is refunded and told", async ({ browser }) => {
    const { orderId } = await seedOrder("design_review")

    const opsContext = await browser.newContext()
    const ops = await opsContext.newPage()
    await signIn(ops, OPERATOR_EMAIL)

    // The review queue is how an operator finds work like this.
    await ops.goto(`/ops/orders/${orderId}`)
    await expect(ops.getByText("design_review").first()).toBeVisible()

    await act(ops, /^Reject/, "walls too thin to print safely")

    // The refund is initiated before the cancellation, so a cancelled order here
    // means the provider accepted it.
    await expect(async () => {
      expect((await orderRow(orderId)).status).toBe("cancelled")
    }).toPass({ timeout: 30_000 })

    // The payment axis is NOT moved by the operator — only the refund webhook
    // may do that (plan §6-S14 step 3).
    expect((await orderRow(orderId)).payment_status).toBe("paid")
    expect(await notificationJobs("cancellation_refund", orderId)).toBe(1)

    const customerContext = await browser.newContext()
    const customer = await customerContext.newPage()
    await signIn(customer, CUSTOMER_EMAIL)
    await customer.goto(`/orders/${orderId}`)
    await expect(customer.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 30_000 })

    await opsContext.close()
    await customerContext.close()
  })

  test("a dispute freezes an order that is already in production", async ({ page, request }) => {
    const { orderId, paymentRef } = await seedOrder("production_queued", "pass")

    // Signed by the mock provider and posted at the real route, byte for byte,
    // so nothing about verification is bypassed.
    const { rawBody, headers } = buildMockWebhook({ type: "dispute.opened", orderId })
    const delivered = await request.post("/api/webhooks/dodo", {
      headers: { ...headers, "content-type": "application/json" },
      data: rawBody,
    })
    expect(delivered.status()).toBe(200)
    expect(paymentRef).toBe(mockPaymentRef(orderId))

    await expect(async () => {
      const order = await orderRow(orderId)
      expect(order.status).toBe("on_hold")
      expect(order.held_from_status).toBe("production_queued")
    }).toPass({ timeout: 30_000 })

    await signIn(page, CUSTOMER_EMAIL)
    await page.goto(`/orders/${orderId}`)
    await expect(page.getByText("On hold", { exact: true })).toBeVisible({ timeout: 30_000 })
  })
})
