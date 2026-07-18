import { expect, test } from "@playwright/test"

test("landing page shows every section", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Describe it. See it. We print it." })).toBeVisible()
  await expect(page.locator("#demo")).toBeVisible()
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "What people make" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Materials & pricing" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible()
  await expect(page.getByText("Currently delivering across India.")).toBeVisible()
})

test("FAQ accordion expands in the browser", async ({ page }) => {
  await page.goto("/")
  const question = page.getByRole("button", { name: "Do I need any design or CAD skills?" })
  await question.click()
  await expect(page.getByText(/You describe the object in plain language/)).toBeVisible()
})

test("header navigation scrolls to sections", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "FAQ" }).click()
  await expect(page).toHaveURL(/#faq$/)
})

test("mobile menu opens on a small viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "Menu" }).click()
  await expect(
    page.getByRole("navigation", { name: "Main mobile" }).getByRole("link", { name: "FAQ" })
  ).toBeVisible()
})
