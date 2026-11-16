import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { StructuredBrief } from "@/src/domain/types"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

vi.mock("@/src/viewer/ViewerWorkspace", () => ({
  ViewerWorkspace: (props: { url: string; swatchColor?: string | null; scaleFactor?: number }) => (
    <div
      data-testid="viewer"
      data-url={props.url}
      data-swatch={props.swatchColor ?? ""}
      data-scale={String(props.scaleFactor ?? 1)}
    />
  ),
}))

vi.mock("@/src/components/studio/creation-panel", () => ({
  CreationPanel: (props: { initialBrief: StructuredBrief | null; onGenerated: () => void }) => (
    <div data-testid="creation-panel" data-prompt={props.initialBrief?.rawPrompt ?? ""}>
      <button type="button" onClick={props.onGenerated}>
        fire-generated
      </button>
    </div>
  ),
}))

vi.mock("@/src/components/studio/stl-upload", () => ({
  StlUpload: (props: { projectId: string; onUploaded: () => void }) => (
    <div data-testid="stl-upload" data-project={props.projectId}>
      <button type="button" onClick={props.onUploaded}>
        fire-uploaded
      </button>
    </div>
  ),
}))

vi.mock("@/src/components/studio/printability-panel", () => ({
  PrintabilityPanel: (props: { designVersionId: string }) => (
    <div data-testid="printability-panel" data-dv={props.designVersionId} />
  ),
}))

vi.mock("@/src/components/studio/configure-panel", () => ({
  ConfigurePanel: (props: { designVersionId: string; onLiveChange: (l: { swatchColor: string | null; scaleFactor: number }) => void }) => (
    <div data-testid="configure-panel" data-dv={props.designVersionId}>
      <button type="button" onClick={() => props.onLiveChange({ swatchColor: "#e8622c", scaleFactor: 2 })}>
        fire-live
      </button>
    </div>
  ),
}))

vi.mock("@/src/components/studio/quote-panel", () => ({
  QuotePanel: (props: { designVersionId: string }) => <div data-testid="quote-panel" data-dv={props.designVersionId} />,
}))

import { CreatorWorkspace } from "@/src/components/studio/creator-workspace"
import { designVersion } from "@/tests/helpers/designVersion"

const project = { id: "proj_1", user_id: "u1", title: "Desk Tidy", status: "active" as const, created_at: "1", updated_at: "1" }

afterEach(() => vi.clearAllMocks())

describe("CreatorWorkspace", () => {
  it("defaults to the newest ready version and shows it in the viewer", () => {
    const versions = [
      designVersion({ id: "dv_2", version_no: 2, generation_status: "creating" }),
      designVersion({ id: "dv_1", version_no: 1, generation_status: "ready", glb_asset_id: "ast_g" }),
    ]
    render(<CreatorWorkspace project={project} versions={versions} />)
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-url", "/api/assets/ast_g")
    // The printability panel tracks the selected version.
    expect(screen.getByTestId("printability-panel")).toHaveAttribute("data-dv", "dv_1")
  })

  it("selecting a version swaps what the viewer shows", async () => {
    const user = userEvent.setup()
    const versions = [
      designVersion({ id: "dv_2", version_no: 2, generation_status: "creating" }),
      designVersion({ id: "dv_1", version_no: 1, generation_status: "ready", glb_asset_id: "ast_g" }),
    ]
    render(<CreatorWorkspace project={project} versions={versions} />)
    expect(screen.getByTestId("viewer")).toBeInTheDocument()
    // Click the still-generating version (identified by its status badge).
    await user.click(screen.getByText("creating").closest("button") as HTMLElement)
    // The generating placeholder replaces the viewer.
    expect(screen.getByText("Generating…")).toBeInTheDocument()
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument()
  })

  it("refines the form from the selected version's brief", async () => {
    const user = userEvent.setup()
    const versions = [designVersion({ id: "dv_1", generation_status: "ready", glb_asset_id: "ast_g" })]
    render(<CreatorWorkspace project={project} versions={versions} />)
    expect(screen.getByTestId("creation-panel")).toHaveAttribute("data-prompt", "")
    await user.click(screen.getByRole("button", { name: "Refine selected" }))
    expect(screen.getByTestId("creation-panel")).toHaveAttribute("data-prompt", "a friendly dinosaur")
  })

  it("refreshes when a generation completes", async () => {
    const user = userEvent.setup()
    render(<CreatorWorkspace project={project} versions={[designVersion({ generation_status: "ready", glb_asset_id: "ast_g" })]} />)
    await user.click(screen.getByRole("button", { name: "fire-generated" }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("offers an STL upload wired to the project and refreshes on upload", async () => {
    const user = userEvent.setup()
    render(<CreatorWorkspace project={project} versions={[]} />)
    expect(screen.getByTestId("stl-upload")).toHaveAttribute("data-project", "proj_1")
    await user.click(screen.getByRole("button", { name: "fire-uploaded" }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("shows the empty state and no refine button without versions", () => {
    render(<CreatorWorkspace project={project} versions={[]} />)
    expect(screen.getByText("No model yet")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Refine selected" })).not.toBeInTheDocument()
  })

  it("switches between the Printability and Configure tabs", async () => {
    const user = userEvent.setup()
    render(<CreatorWorkspace project={project} versions={[designVersion({ id: "dv_1", generation_status: "ready", glb_asset_id: "ast_g" })]} />)

    // Printability is the default active tab; the Configure panel is hidden but mounted.
    expect(screen.getByRole("tab", { name: "Printability" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Configure" })).toHaveAttribute("aria-selected", "false")
    expect(document.getElementById("panel-configure")).toHaveAttribute("hidden")
    expect(screen.getByTestId("configure-panel")).toHaveAttribute("data-dv", "dv_1")

    await user.click(screen.getByRole("tab", { name: "Configure" }))
    expect(screen.getByRole("tab", { name: "Configure" })).toHaveAttribute("aria-selected", "true")
    expect(document.getElementById("panel-configure")).not.toHaveAttribute("hidden")

    await user.click(screen.getByRole("tab", { name: "Quote" }))
    expect(document.getElementById("panel-quote")).not.toHaveAttribute("hidden")
    expect(screen.getByTestId("quote-panel")).toHaveAttribute("data-dv", "dv_1")
  })

  it("feeds the Configure panel's live swatch + scale into the viewer", async () => {
    const user = userEvent.setup()
    render(<CreatorWorkspace project={project} versions={[designVersion({ id: "dv_1", generation_status: "ready", glb_asset_id: "ast_g" })]} />)
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-scale", "1")

    await user.click(screen.getByRole("tab", { name: "Configure" }))
    await user.click(screen.getByRole("button", { name: "fire-live" }))
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-swatch", "#e8622c")
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-scale", "2")
  })

  it("hides refine when the selected version has no brief", () => {
    render(
      <CreatorWorkspace
        project={project}
        versions={[designVersion({ brief_json: null, generation_status: "ready", glb_asset_id: "ast_g" })]}
      />
    )
    expect(screen.queryByRole("button", { name: "Refine selected" })).not.toBeInTheDocument()
  })
})
