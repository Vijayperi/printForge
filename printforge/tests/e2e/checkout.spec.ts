import { expect, test, type Page } from "@playwright/test"

/**
 * Checkout end-to-end (plan §6-S13 step 5). Walks the whole golden path — upload
 * → configure → quote → checkout form → mock hosted payment → webhook → order
 * status — plus the payment-failure path. The mock payment page posts a
 * genuinely signed, Dodo-shaped webhook at the real route, so nothing about the
 * payment path is stubbed except the hosted page itself.
 *
 * Requires the local Supabase stack + a running worker (`npm run dev:worker`).
 * Skipped unless E2E_SUPABASE=1.
 */

function box(sx: number, sy: number, sz: number): number[][] {
  const v0 = [0, 0, 0], v1 = [sx, 0, 0], v2 = [sx, sy, 0], v3 = [0, sy, 0]
  const v4 = [0, 0, sz], v5 = [sx, 0, sz], v6 = [sx, sy, sz], v7 = [0, sy, sz]
  const f = (a: number[], b: number[], c: number[]): number[] => [...a, ...b, ...c]
  return [
    f(v0, v2, v1), f(v0, v3, v2),
    f(v4, v5, v6), f(v4, v6, v7),
    f(v0, v1, v5), f(v0, v5, v4),
    f(v3, v7, v6), f(v3, v6, v2),
    f(v0, v4, v7), f(v0, v7, v3),
    f(v1, v2, v6), f(v1, v6, v5),
  ]
}

function binaryStl(triangles: number[][]): Buffer {
  const bytes = Buffer.alloc(84 + 50 * triangles.length)
  bytes.writeUInt32LE(triangles.length, 80)
  triangles.forEach((tri, i) => {
    const base = 84 + 50 * i + 12
    for (let v = 0; v < 9; v += 1) bytes.writeFloatLE(tri[v] as number, base + v * 4)
  })
  return bytes
}

/**
 * Select a workspace tab and wait for its panel. The tab strip is a client
 * component beside a 3D canvas, so an early click can land before hydration and
 * do nothing — retry the click until the panel actually opens.
 */
async function openTab(page: Page, name: string, panel: string): Promise<void> {
  await expect(async () => {
    await page.getByRole("tab", { name }).click({ force: true })
    await expect(page.locator(`#panel-${panel}`)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
}

/** Sign up, create a project, upload a cube, configure it, and get it quoted. */
async function reachQuote(page: Page, label: string): Promise<void> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Checkout Tester")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByLabel("Confirm password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/projects$/)

  await page.getByRole("button", { name: "New project" }).click()
  await page.getByLabel("Project name").fill("PayFlow")
  await page.getByRole("button", { name: "Create" }).click()
  await page.getByText("PayFlow").click()
  await expect(page).toHaveURL(/\/projects\/proj_/)

  await page
    .getByLabel("Upload your own STL")
    .setInputFiles({ name: "cube.stl", mimeType: "model/stl", buffer: binaryStl(box(10, 10, 10)) })
  await page.getByRole("button", { name: "Upload STL" }).click()
  await expect(page.getByText("Ready to print")).toBeVisible({ timeout: 45_000 })

  await openTab(page, "Configure", "configure")
  await expect(page.getByLabel("Size (longest side) in mm", { exact: true })).toBeVisible({
    timeout: 45_000,
  })
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 45_000 })

  await openTab(page, "Quote", "quote")
  // The 3D canvas keeps re-laying-out beneath the panel, so force past the
  // stability check rather than waiting for a scene that never settles.
  await page.getByRole("button", { name: "Get a quote" }).click({ force: true })
  await expect(page.getByText("Total (incl. taxes where applicable)")).toBeVisible({
    timeout: 60_000,
  })
}

/** Fill the checkout form and open the (mock) hosted payment page. */
async function payThrough(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Proceed to checkout" }).click({ force: true })
  await expect(page).toHaveURL(/\/checkout\?quoteId=qt_/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible()

  await page.getByLabel("Full name").fill("Asha Rao")
  await page.getByLabel("Email").fill("asha@example.com")
  await page.getByLabel("Mobile number").fill("9876543210")
  await page.getByLabel("Address line 1").fill("12 Residency Road")
  await page.getByLabel("City").fill("Bengaluru")
  await page.getByLabel("State").selectOption("Karnataka")
  await page.getByLabel("PIN code").fill("560025")

  await page.getByRole("button", { name: "Pay with Dodo" }).click()
  await expect(page).toHaveURL(/\/mock-checkout\/cks_mock_ord_/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { name: "Mock payment" })).toBeVisible()
}

test.describe("checkout (Supabase + worker)", () => {
  test.skip(
    process.env["E2E_SUPABASE"] !== "1",
    "requires local Supabase + worker (set E2E_SUPABASE=1)"
  )

  test("golden path: quote → pay → webhook settles the order", async ({ page }) => {
    await reachQuote(page, "pay")
    await payThrough(page)

    await page.getByRole("button", { name: "Pay" }).click()
    await expect(page).toHaveURL(/\/orders\/ord_/, { timeout: 30_000 })

    // The webhook — not the browser's return trip — is what settles the order.
    // A clean cube passes printability, so it auto-approves past design review.
    await expect(page.locator('li[aria-current="step"]')).toHaveText(/Queued|Design review/, {
      timeout: 30_000,
    })
    await expect(page.getByText("Confirming your payment")).toBeHidden()
    await expect(page.getByText(/pay_mock_ord_/)).toBeVisible()

    await page.getByRole("link", { name: "My orders" }).click()
    await expect(page.getByRole("link", { name: /ord_/ })).toBeVisible()
  })

  test("failure path: a declined payment cancels the order", async ({ page }) => {
    await reachQuote(page, "fail")
    await payThrough(page)

    await page.getByRole("button", { name: "Fail" }).click()
    await expect(page).toHaveURL(/\/orders\/ord_/, { timeout: 30_000 })
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('li[aria-current="step"]')).toHaveCount(0)
  })
})
