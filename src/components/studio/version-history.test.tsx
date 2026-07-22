import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import { VersionHistory } from "@/src/components/studio/version-history"
import { designVersion } from "@/tests/helpers/designVersion"

describe("VersionHistory", () => {
  it("renders an empty state", () => {
    render(<VersionHistory versions={[]} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText(/No versions yet/)).toBeInTheDocument()
  })

  it("lists versions with status badges and marks the selected one", () => {
    const versions = [
      designVersion({ id: "dv_2", version_no: 2, generation_status: "ready", thumbnail_asset_id: "ast_t" }),
      designVersion({ id: "dv_1", version_no: 1, generation_status: "failed", prompt: null }),
    ]
    render(<VersionHistory versions={versions} selectedId="dv_2" onSelect={() => {}} />)
    const list = screen.getByRole("list", { name: "Version history" })
    const items = within(list).getAllByRole("button")
    expect(items[0]).toHaveAttribute("aria-current", "true")
    expect(items[1]).toHaveAttribute("aria-current", "false")
    // Thumbnail image for the version with a thumbnail asset.
    expect(within(items[0] as HTMLElement).getByRole("img")).toHaveAttribute("src", "/api/assets/ast_t")
    // Fallback label for the one without.
    expect(within(items[1] as HTMLElement).getByText("v1")).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText("Untitled version")).toBeInTheDocument()
  })

  it("truncates a long prompt", () => {
    const long = "x".repeat(120)
    render(<VersionHistory versions={[designVersion({ prompt: long })]} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText(`${"x".repeat(80)}…`)).toBeInTheDocument()
  })

  it("uses a fallback badge variant for an unknown status", () => {
    render(<VersionHistory versions={[designVersion({ generation_status: "weird" })]} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText("weird")).toBeInTheDocument()
  })

  it("calls onSelect when a version is clicked", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const version = designVersion({ id: "dv_9" })
    render(<VersionHistory versions={[version]} selectedId={null} onSelect={onSelect} />)
    await user.click(screen.getByRole("button"))
    expect(onSelect).toHaveBeenCalledWith(version)
  })

  it("has no accessibility violations", async () => {
    const { container } = render(
      <VersionHistory versions={[designVersion({ thumbnail_asset_id: "ast_t" })]} selectedId="dv_1" onSelect={() => {}} />
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
