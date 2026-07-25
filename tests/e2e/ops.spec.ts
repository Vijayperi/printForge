import { createClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

/**
 * The operations journey end-to-end (plan §6-S14 step 5): a paid order is
 * approved, put on a printer, quality-checked and shipped by an operator, and
 * the customer sees Shipped with a tracking number.
 *
 * Two legs are seeded rather than driven, both deliberately:
 *  - the order lineage, because `checkout.spec.ts` already walks the whole
 *    prompt → pay path and repeating it here would only make this spec slower
 *    and flakier;
 *  - `printing → completed`, because nothing in S14 fires RELEASE/STARTED/
 *    COMPLETED — that is Session 15's poller, so there is no live way to reach
 *    a finished print yet. Release is asserted *disabled with its reason*.
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
const PRINTER_NAME = "Bay 1 — Prusa MK4"
const TRACKING = "BD-99001122"

const client = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Seed a paid order awaiting design review, owned by the seeded customer. */
async function seedOrder(): Promise<string> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const projectId = `proj_e2eops_${tag}`
  const dvId = `dv_e2eops_${tag}`
  const cfgId = `cfg_e2eops_${tag}`
  const quoteId = `qt_e2eops_${tag}`
  const orderId = `ord_e2eops_${tag}`

  await client.from("projects").insert({ id: projectId, user_id: CUSTOMER_UID, title: "Ops E2E" })
  await client.from("design_versions").insert({
    id: dvId,
    project_id: projectId,
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
  })
  await client.from("validation_reports").insert({
    id: `vr_e2eops_${tag}`,
    design_version_id: dvId,
    printer_profile_id: "generic-fdm",
    status: "pass",
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
    amount_minor: 24360,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  })
  await client.from("orders").insert({
    id: orderId,
    user_id: CUSTOMER_UID,
    quote_id: quoteId,
    status: "design_review",
    payment_status: "paid",
    payment_ref: `pay_e2eops_${tag}`,
    paid_at: new Date().toISOString(),
    contact_json: { name: "Chitra One", email: CUSTOMER_EMAIL, phone: "+919876543210" },
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
  return orderId
}

/** Walk the print to `completed` the way Session 15's poller will. */
async function finishPrint(orderId: string): Promise<void> {
  await client.from("print_jobs").update({ status: "completed" }).eq("order_id", orderId)
  await client.from("orders").update({ status: "quality_check" }).eq("id", orderId)
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD)
  await page.getByRole("button", { name: "Log in" }).click()
  // The session cookie is only set once the action redirects; navigating before
  // that lands on a 404 ops page instead of the board.
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

test.describe("ops production journey (Supabase)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase (set E2E_SUPABASE=1)")

  test("approve → assign → quality check → ship, and the customer sees it", async ({ browser }) => {
    const orderId = await seedOrder()

    const opsContext = await browser.newContext()
    const ops = await opsContext.newPage()
    await signIn(ops, OPERATOR_EMAIL)

    // The board is the operator's way in, and the order must be on it.
    await ops.goto("/ops")
    await ops.getByRole("link", { name: orderId }).click()
    await expect(ops).toHaveURL(new RegExp(`/ops/orders/${orderId}$`))

    // 1. Review: approve out of design review.
    await act(ops, "Approve", "printability passed and the model looks right")
    await expect(ops.getByText(/· Queued/)).toBeVisible({ timeout: 30_000 })

    // 2. Queue a print.
    await act(ops, "Queue a print", "customer paid, approved for production")
    await expect(ops.getByText("Print 1/3")).toBeVisible({ timeout: 30_000 })
    await expect(ops.getByText("Not released")).toBeVisible()

    // 3. Put it on a machine.
    await ops.getByLabel("Printer").selectOption({ label: PRINTER_NAME })
    await act(ops, "Assign", "bay 1 is free and has PLA loaded")
    // Scoped to the summary line: the same name is also an <option> in the picker.
    await expect(ops.locator("dd", { hasText: PRINTER_NAME })).toBeVisible({ timeout: 30_000 })

    // 4. Release is drawn but inert until Session 15 — and says so.
    const release = ops.getByRole("button", { name: "Release to printer" })
    await expect(release).toBeDisabled()
    await expect(ops.getByText(/release unlocks with the printer gateway/i)).toBeVisible()

    // 5. The print finishes (seeded — see the file header), then QC passes.
    await finishPrint(orderId)
    await ops.reload()
    await expect(ops.getByText("Record the quality check before shipping.")).toBeVisible()

    await act(ops, "QC pass", "dimensions and finish within tolerance")
    await expect(ops.getByLabel("Tracking number")).toBeVisible({ timeout: 30_000 })

    // 6. Tracking is what actually ships the order.
    await ops.getByLabel("Carrier").selectOption("blue_dart")
    await ops.getByLabel("Tracking number").fill(TRACKING)
    await ops.getByRole("button", { name: "Mark shipped" }).click()
    await expect(ops.getByText(new RegExp(`Shipped with Blue Dart · ${TRACKING}`))).toBeVisible({
      timeout: 30_000,
    })

    // 7. The customer's own page reflects every step of it.
    const customerContext = await browser.newContext()
    const customer = await customerContext.newPage()
    await signIn(customer, CUSTOMER_EMAIL)
    await customer.goto(`/orders/${orderId}`)

    await expect(customer.locator('li[aria-current="step"]')).toHaveText("Shipped", {
      timeout: 30_000,
    })
    await expect(customer.getByRole("heading", { name: "Tracking" })).toBeVisible()
    await expect(customer.getByText("Blue Dart")).toBeVisible()
    await expect(customer.getByText(TRACKING)).toBeVisible()

    await customerContext.close()
    await opsContext.close()
  })

  test("a customer cannot reach an operator order page", async ({ page }) => {
    const orderId = await seedOrder()
    await signIn(page, CUSTOMER_EMAIL)

    // 404, never 403 — the ops surface does not confirm it exists.
    const response = await page.goto(`/ops/orders/${orderId}`)
    expect(response?.status()).toBe(404)
  })
})
