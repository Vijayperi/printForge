import { expect, test } from "@playwright/test"

test("home page renders the PrintForge hero", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("PrintForge", { exact: true })).toBeVisible()
  await expect(page.getByText("Describe it. See it. We print it.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Start creating" })).toBeVisible()
  await expect(page.getByRole("link", { name: "See examples" })).toBeVisible()
})
