import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/src/viewer/ViewerWorkspace", () => ({
  ViewerWorkspace: (props: {
    url: string
    projectTitle: string
    swatchColor?: string | null
    scaleFactor?: number
  }) => (
    <div
      data-testid="viewer"
      data-url={props.url}
      data-title={props.projectTitle}
      data-swatch={props.swatchColor ?? ""}
      data-scale={String(props.scaleFactor ?? 1)}
    />
  ),
}))

import { WorkspaceViewer } from "@/src/components/studio/workspace-viewer"
import { designVersion } from "@/tests/helpers/designVersion"

describe("WorkspaceViewer", () => {
  it("shows the empty placeholder when there is no version", () => {
    render(<WorkspaceViewer version={null} projectTitle="Desk" />)
    expect(screen.getByText("No model yet")).toBeInTheDocument()
  })

  it("renders the viewer for a ready version with a GLB asset", () => {
    render(
      <WorkspaceViewer
        version={designVersion({ generation_status: "ready", glb_asset_id: "ast_glb" })}
        projectTitle="Desk Tidy"
      />
    )
    const viewer = screen.getByTestId("viewer")
    expect(viewer).toHaveAttribute("data-url", "/api/assets/ast_glb")
    expect(viewer).toHaveAttribute("data-title", "Desk Tidy")
  })

  it("forwards the live swatch colour and scale factor to the viewer", () => {
    render(
      <WorkspaceViewer
        version={designVersion({ generation_status: "ready", glb_asset_id: "ast_glb" })}
        projectTitle="Desk"
        swatchColor="#e8622c"
        scaleFactor={1.5}
      />
    )
    const viewer = screen.getByTestId("viewer")
    expect(viewer).toHaveAttribute("data-swatch", "#e8622c")
    expect(viewer).toHaveAttribute("data-scale", "1.5")
  })

  it("shows the failed placeholder", () => {
    render(<WorkspaceViewer version={designVersion({ generation_status: "failed" })} projectTitle="Desk" />)
    expect(screen.getByText("Generation failed")).toBeInTheDocument()
  })

  it("shows the generating placeholder for an in-progress version", () => {
    render(<WorkspaceViewer version={designVersion({ generation_status: "creating" })} projectTitle="Desk" />)
    expect(screen.getByText("Generating…")).toBeInTheDocument()
  })

  it("shows the generating placeholder when ready but the GLB is not attached yet", () => {
    render(
      <WorkspaceViewer
        version={designVersion({ generation_status: "ready", glb_asset_id: null })}
        projectTitle="Desk"
      />
    )
    expect(screen.getByText("Generating…")).toBeInTheDocument()
  })
})
