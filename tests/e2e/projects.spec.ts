import { expect, test } from "@playwright/test"

/**
 * Projects CRUD against a real Supabase-backed dev server.
 * Requires the local Supabase stack and .env.local; skipped by default (and in
 * CI) unless E2E_SUPABASE=1. Run locally with: E2E_SUPABASE=1 npm run e2e.
 */
test.describe("projects CRUD (Supabase)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase (set E2E_SUPABASE=1)")

  const email = `e2e-proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("sign up, create, rename, and archive a project", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Project Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    // Empty state first.
    await expect(page.getByText("No projects yet")).toBeVisible()

    // Create.
    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("My first print")
    await page.getByRole("button", { name: "Create" }).click()
    await expect(page.getByText("My first print")).toBeVisible()

    // Rename.
    await page.getByRole("button", { name: "Rename" }).click()
    const renameDialog = page.getByRole("dialog")
    await renameDialog.getByLabel("Project name").fill("Renamed print")
    await renameDialog.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Renamed print")).toBeVisible()

    // Archive (confirm in the alert dialog).
    await page.getByRole("button", { name: "Archive" }).click()
    const alert = page.getByRole("alertdialog")
    await alert.getByRole("button", { name: "Archive" }).click()
    await expect(page.getByText("archived")).toBeVisible()
  })
})
