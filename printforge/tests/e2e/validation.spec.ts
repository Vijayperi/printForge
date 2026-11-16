import { expect, test, type Page } from "@playwright/test"

/**
 * Printability verdicts end-to-end (plan §6-S10 step 5). Uploads STLs and waits
 * for the async validation.run worker to produce a report, then asserts the
 * PrintabilityPanel verdict. Requires the local Supabase stack + a running
 * worker (`npm run dev:worker`). Skipped unless E2E_SUPABASE=1.
 */

// Outward-wound (CCW) triangles of an axis-aligned box (matches tests/helpers/geometry).
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
const holedCube = () => binaryStl(box(10, 10, 10).filter((_, i) => i !== 2 && i !== 3))
const oversizedCube = () => binaryStl(box(300, 10, 10))

async function uploadAndExpectVerdict(page: Page, name: string, stl: Buffer, verdict: string) {
  await page
    .getByLabel("Upload your own STL")
    .setInputFiles({ name, mimeType: "model/stl", buffer: stl })
  await page.getByRole("button", { name: "Upload STL" }).click()
  await expect(page.getByText(verdict)).toBeVisible({ timeout: 45_000 })
}

test.describe("printability verdicts (Supabase + worker)", () => {
  test.skip(process.env["E2E_SUPABASE"] !== "1", "requires local Supabase + worker (set E2E_SUPABASE=1)")

  const email = `e2e-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@printforge.test`
  const password = "printforge-e2e-123"

  test("clean cube passes, holed cube needs review, oversized cube fails", async ({ page }) => {
    await page.goto("/sign-up")
    await page.getByLabel("Name").fill("Verdict Tester")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByLabel("Confirm password").fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/projects$/)

    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Project name").fill("Verdicts")
    await page.getByRole("button", { name: "Create" }).click()
    await page.getByText("Verdicts").click()
    await expect(page).toHaveURL(/\/projects\/proj_/)

    await uploadAndExpectVerdict(page, "clean.stl", cleanCube(), "Ready to print")
    await uploadAndExpectVerdict(page, "holed.stl", holedCube(), "Needs a human check")
    await uploadAndExpectVerdict(page, "oversized.stl", oversizedCube(), "Not printable yet")
  })
})
