import { expect, test } from "@playwright/test"

/**
 * Direct STL upload against a real Supabase-backed dev server. Requires the
 * local Supabase stack + .env.local. The upload route does everything
 * synchronously (no worker needed). Skipped unless E2E_SUPABASE=1.
 */
function binaryStl(): Buffer {
  // 80-byte header + uint32 triangle count (1) + one 50-byte triangle record.
  const bytes = Buffer.alloc(84 + 50)
  bytes.writeUInt32LE(1, 80)
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  for (let v = 0; v < 9; v += 1) bytes.writeFloatLE(tri[v] as number, 84 + 12 + v * 4)
  return bytes
}

test.describe("STL upload (Supabase)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase (set E2E_SUPABASE=1)")

  const email = `e2e-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("upload an STL and see it as a first-class version in the viewer", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Upload Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("My uploads")
    await page.getByRole("button", { name: "Create" }).click()
    await page.getByText("My uploads").click()
    await expect(page).toHaveURL(/\/projects\/proj_/)

    await page
      .getByLabel("Upload your own STL")
      .setInputFiles({ name: "cube.stl", mimeType: "model/stl", buffer: binaryStl() })
    await page.getByRole("button", { name: "Upload STL" }).click()

    // The uploaded version appears in history with an "Uploaded" badge, and the
    // 3D viewer mounts.
    await expect(page.getByText("Uploaded")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("toolbar", { name: "3D viewer controls" })).toBeVisible({ timeout: 30_000 })
  })
})
