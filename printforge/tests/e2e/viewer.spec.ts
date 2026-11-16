import { expect, test } from "@playwright/test"

test("landing 3D viewer mounts and toggles between visual and mesh modes", async ({ page }) => {
  await page.goto("/")
  // Scroll the deferred demo into view so the IntersectionObserver loads it.
  await page.locator("#demo").scrollIntoViewIfNeeded()

  const toolbar = page.getByRole("toolbar", { name: "3D viewer controls" })
  await expect(toolbar).toBeVisible({ timeout: 20_000 })
  await expect(page.locator("#demo canvas")).toBeVisible()

  // data-viewer-mode reflects the current mode and reacts to the toggle.
  await expect(toolbar).toHaveAttribute("data-viewer-mode", "visual")
  await page.getByRole("button", { name: "Technical Mesh" }).click()
  await expect(toolbar).toHaveAttribute("data-viewer-mode", "mesh")
  await page.getByRole("button", { name: "Visual", exact: true }).click()
  await expect(toolbar).toHaveAttribute("data-viewer-mode", "visual")

  // Overlay toggles and camera controls are keyboard-reachable buttons.
  await page.getByRole("button", { name: "Reset view" }).click()
  await expect(page.getByRole("switch", { name: "Show normals" })).toBeVisible()
})
