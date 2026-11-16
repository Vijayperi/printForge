import { expect, test, type Page } from "@playwright/test"

/**
 * Print configuration end-to-end (plan §6-S11 step 4). Uploads a clean cube,
 * opens the Configure tab, and exercises: the size constraint matrix, a size
 * change that re-checks printability at the new scale, and per-design-version
 * persistence across a reload. Requires the local Supabase stack + a running
 * worker (`npm run dev:worker`). Skipped unless E2E_SUPABASE=1.
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

const cleanCube = () => binaryStl(box(10, 10, 10))

async function uploadCube(page: Page): Promise<void> {
  await page
    .getByLabel("Upload your own STL")
    .setInputFiles({ name: "cube.stl", mimeType: "model/stl", buffer: cleanCube() })
  await page.getByRole("button", { name: "Upload STL" }).click()
  await expect(page.getByText("Ready to print")).toBeVisible({ timeout: 45_000 })
}

test.describe("print configuration (Supabase + worker)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase + worker (set E2E_SUPABASE=1)")

  const email = `e2e-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("configures, re-checks on resize, and persists per design version", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Config Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("ResizeFlow")
    await page.getByRole("button", { name: "Create" }).click()
    await page.getByText("ResizeFlow").click()
    await expect(page).toHaveURL(/\/projects\/proj_/)

    await uploadCube(page)

    // Open the Configure tab.
    await page.getByRole("tab", { name: "Configure" }).click({ force: true })
    const sizeInput = page.getByLabel("Size (longest side) in mm", { exact: true })
    await expect(sizeInput).toBeVisible()

    // A size beyond the build volume is blocked with an inline constraint.
    await sizeInput.fill("400")
    await expect(page.getByText(/build volume/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled()

    // A valid larger size saves and re-checks printability at the new scale. The
    // "Re-checking…" notice is transient (the worker re-validates quickly), so we
    // assert the durable outcome: the save persists and the re-validated report
    // still passes at the new scale.
    await sizeInput.fill("150")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 45_000 })
    await page.getByRole("tab", { name: "Printability" }).click({ force: true })
    await expect(page.getByText("Ready to print")).toBeVisible({ timeout: 45_000 })

    // The configuration persists for this design version across a reload.
    await page.reload()
    await page.getByRole("tab", { name: "Configure" }).click({ force: true })
    await expect(page.getByLabel("Size (longest side) in mm", { exact: true })).toHaveValue("150")
  })
})
