import { expect, test, type Page } from "@playwright/test"

/**
 * Quote end-to-end (plan §6-S12 step 4). Uploads a clean cube, saves a
 * configuration, then requests a quote and waits for the async slicing.run worker
 * to price it — asserting the INR breakdown renders. Requires the local Supabase
 * stack + a running worker (`npm run dev:worker`). Skipped unless E2E_SUPABASE=1.
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

async function uploadCube(page: Page): Promise<void> {
  await page
    .getByLabel("Upload your own STL")
    .setInputFiles({ name: "cube.stl", mimeType: "model/stl", buffer: binaryStl(box(10, 10, 10)) })
  await page.getByRole("button", { name: "Upload STL" }).click()
  await expect(page.getByText("Ready to print")).toBeVisible({ timeout: 45_000 })
}

test.describe("quote (Supabase + worker)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase + worker (set E2E_SUPABASE=1)")

  const email = `e2e-quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("configures, requests a quote, and renders the INR breakdown", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Quote Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("QuoteFlow")
    await page.getByRole("button", { name: "Create" }).click()
    await page.getByText("QuoteFlow").click()
    await expect(page).toHaveURL(/\/projects\/proj_/)

    await uploadCube(page)

    // Save a configuration so the quote has something to price.
    await page.getByRole("tab", { name: "Configure" }).click({ force: true })
    await expect(page.getByLabel("Size (longest side) in mm", { exact: true })).toBeVisible({ timeout: 45_000 })
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 45_000 })

    // Request a quote and wait for the worker to slice + price it.
    await page.getByRole("tab", { name: "Quote" }).click({ force: true })
    await page.getByRole("button", { name: "Get a quote" }).click()
    await expect(page.getByText("Total (incl. taxes where applicable)")).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole("row", { name: /Material/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "Proceed to checkout" })).toBeDisabled()
  })
})
