import { expect, test } from "@playwright/test"

/**
 * Creator golden path against a real Supabase-backed dev server WITH the job
 * worker running. Requires the local Supabase stack, .env.local, and
 * `npm run dev:worker`. Skipped by default (and in CI) unless E2E_SUPABASE=1.
 */
test.describe("creator workspace (Supabase + worker)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase and a running worker")

  const email = `e2e-creator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("sign up, create a project, generate a model, and see it in the viewer", async ({ page }) => {
    // Sign up.
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Creator Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    // Create and open a project.
    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("Dino holder")
    await page.getByRole("button", { name: "Create" }).click()
    await page.getByText("Dino holder").click()
    await expect(page).toHaveURL(/\/projects\/proj_/)

    // Fill the guided brief and generate.
    await page.getByLabel("What would you like to create?").fill("a friendly dinosaur pen holder")
    await page.getByLabel("Intended use").fill("desk organiser")
    await page.getByLabel("Approx. size (mm)").fill("90")
    await page.getByLabel("Style").fill("cute")
    await page.getByRole("button", { name: "Generate" }).click()

    // The worker walks it to ready; a version appears and the 3D canvas mounts.
    await expect(page.getByRole("list", { name: "Version history" })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("toolbar", { name: "3D viewer controls" })).toBeVisible({ timeout: 45_000 })
    await expect(page.locator("canvas")).toBeVisible()
  })
})
