import { expect, test } from "@playwright/test"

test("home page renders the PrintForge hero", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("banner").getByRole("link", { name: "PrintForge" })).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Describe it. See it. We print it." })
  ).toBeVisible()
  await expect(page.getByRole("search").getByRole("button", { name: "Start creating" })).toBeVisible()
  await expect(page.getByRole("main").getByRole("link", { name: "See examples" }).first()).toBeVisible()
})
