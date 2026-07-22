import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "@/src/components/ui/tabs"

function renderTabs(props: React.ComponentProps<typeof Tabs> = {}) {
  return render(
    <Tabs defaultValue="a" {...props}>
      <TabsList aria-label="Sections" className="list-x">
        <TabsTrigger value="a" className="trigger-x">
          First
        </TabsTrigger>
        <TabsTrigger value="b">Second</TabsTrigger>
      </TabsList>
      <TabsContent value="a" className="content-x">
        Panel A
      </TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>
  )
}

describe("Tabs", () => {
  it("renders horizontal by default and shows the default panel", () => {
    renderTabs()
    const root = document.querySelector('[data-slot="tabs"]')
    expect(root).toHaveAttribute("data-orientation", "horizontal")
    expect(screen.getByRole("tab", { name: "First" })).toHaveClass("trigger-x")
    expect(screen.getByText("Panel A")).toHaveClass("content-x")
    expect(screen.getByRole("tablist", { name: "Sections" })).toHaveClass("list-x")
  })

  it("supports a vertical orientation", () => {
    renderTabs({ orientation: "vertical" })
    expect(document.querySelector('[data-slot="tabs"]')).toHaveAttribute("data-orientation", "vertical")
  })

  it("switches the visible panel on trigger click", async () => {
    const user = userEvent.setup()
    renderTabs()
    await user.click(screen.getByRole("tab", { name: "Second" }))
    expect(screen.getByText("Panel B")).toBeVisible()
  })

  it("renders the line variant list", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>
    )
    expect(document.querySelector('[data-slot="tabs-list"]')).toHaveAttribute("data-variant", "line")
  })

  it("tabsListVariants composes classes", () => {
    expect(tabsListVariants({ variant: "default" })).toContain("bg-muted")
    expect(tabsListVariants({ variant: "line" })).toContain("bg-transparent")
  })

  it("has no accessibility violations", async () => {
    const { container } = renderTabs()
    expect(await axe(container)).toHaveNoViolations()
  })
})
