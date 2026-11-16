import { expect, test } from "@playwright/test"

/**
 * Full auth lifecycle against a real Supabase-backed dev server.
 * Requires the local Supabase stack (`supabase start`) and .env.local.
 * Skipped by default (and in CI) unless E2E_SUPABASE=1, since CI has no
 * Supabase service. Run locally with: E2E_SUPABASE=1 npm run e2e.
 */
test.describe("auth lifecycle (Supabase)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase (set E2E_SUPABASE=1)")

  const unique = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("sign up, sign out, log back in", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("E2E Tester")
    await page.getByLabel("Email").fill(unique)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()

    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible()

    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.goto("/login")
    await page.getByLabel("Email").fill(unique)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page).toHaveURL(/\/projects$/)
  })

  test("signed-in customer cannot reach the ops dashboard (404)", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill(unique)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    const response = await page.goto("/ops")
    expect(response?.status()).toBe(404)
  })

  test("anonymous visitor to a studio route is redirected to login", async ({ page }) => {
    const response = await page.goto("/projects")
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/)
    expect(response).not.toBeNull()
  })
})
